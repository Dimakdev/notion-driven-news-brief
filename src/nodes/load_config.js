// [2] Load the control panel: Topics, Sources and Settings come in from three Notion nodes and leave
// as one config object. Everything downstream reads this and nothing else, so the prompt never has to
// know what the user cares about — the database does.
//
// Defaults below apply when a field is left empty in Notion. They are the only place in the workflow
// where a number is hard-coded, and each one is also a row in the Settings table, so the user can
// override it without touching this file.
const DEFAULTS = {
  windowHours: 24,      // Topics -> Window
  threshold: 60,        // Topics -> Threshold: score above this ships. NOT a cap on how many ship.
  budgetCeiling: 250,   // Settings -> Budget ceiling: max candidates handed to the model per run
  memoryDays: 30,       // Settings -> Memory window: how long a URL stays in the seen-index
  briefTime: '05:00',
  channel: 'telegram',
  lang: 'en',        // Settings -> Brief language: the digest's own words
  weeklyReviewDay: 'sunday',
};

// n8n's Notion node returns either the raw API page or a "simplified" shape depending on its options
// and version. Reading through one helper means a version bump cannot silently empty a field.
function prop(page, name) {
  const p = (page.properties || {})[name];
  if (p === undefined) return page[name];               // simplified output puts values at the top level
  if (p === null) return null;
  switch (p.type) {
    case 'title': return (p.title || []).map((t) => t.plain_text).join('');
    case 'rich_text': return (p.rich_text || []).map((t) => t.plain_text).join('');
    case 'select': return p.select ? p.select.name : null;
    case 'multi_select': return (p.multi_select || []).map((o) => o.name);
    case 'number': return p.number;
    case 'checkbox': return p.checkbox;
    case 'url': return p.url;
    case 'date': return p.date ? p.date.start : null;
    case 'relation': return (p.relation || []).map((r) => r.id);
    default: return p[p.type] ?? null;
  }
}

// A Notion query answers with ONE object holding a `results` array, so an HTTP node hands this Code
// node a single item containing every row. Iterating the items directly would loop once over the
// envelope and find nothing — which looks exactly like "no active topics" and is why this helper is
// its own named thing rather than an inline expression.
function pages(nodeName) {
  const out = [];
  for (const item of $(nodeName).all()) {
    const j = item.json || {};
    if (Array.isArray(j.results)) out.push(...j.results);
    else if (j.id || j.properties) out.push(j);
  }
  return out;
}

const id = (page) => String(page.id || page.page_id || '').replace(/-/g, '');
const norm = (s) => String(s || '').trim().toLowerCase();
const isOn = (v) => ['on', 'yes', 'on', 'true', 'yes', '1'].includes(norm(v));

// ---------------------------------------------------------------- settings
const settings = {};
for (const page of pages('Notion: Settings')) {
  const key = norm(prop(page, 'Key'));
  if (key) settings[key] = String(prop(page, 'Value') ?? '').trim();
}
const num = (key, fallback) => {
  const n = Number(settings[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const config = {
  paused: isOn(settings['pause']),
  channel: norm(settings['channel']) || DEFAULTS.channel,
  briefTime: settings['brief time'] || DEFAULTS.briefTime,
  budgetCeiling: num('budget ceiling', DEFAULTS.budgetCeiling),
  memoryDays: num('memory window', DEFAULTS.memoryDays),
  weeklyReview: isOn(settings['weekly review']),
  weeklyReviewDay: norm(settings['review day']) || DEFAULTS.weeklyReviewDay,
  reviewNow: isOn(settings['review now']),
  // n8n blocks $env inside Code nodes by default, and asking the user to flip a container flag to read
  // one address would be a poor trade. It lives in Settings like everything else the user can set.
  publicBase: String(settings['n8n address'] || 'http://localhost:5678').replace(/\/$/, ''),
  // Which language the digest is written in. The model is told this, and the handful of fixed
  // strings around it follow. Everything else in the system stays English.
  lang: (norm(settings['brief language']) || DEFAULTS.lang).slice(0, 2),
  runDate: DateTime.now().toISODate(),
};

// ---------------------------------------------------------------- topics
const topics = [];
for (const page of pages('Notion: Topics')) {
  if (prop(page, 'Status') !== 'Active') continue;
  const signals = (prop(page, 'Signals') || []).map(norm).filter(Boolean);
  topics.push({
    id: id(page),
    name: prop(page, 'Topic') || '(unnamed)',
    // The text the model judges against. An empty criterion would make every score meaningless,
    // so such a topic is skipped loudly rather than silently mis-scoring everything.
    criterion: (prop(page, 'Criterion') || '').trim(),
    signals,
    // An empty Signals list is a deliberate escape hatch: it turns the keyword filter OFF for this
    // topic, so everything inside the time window reaches the model. Costs more, misses nothing.
    keywordFilter: signals.length > 0,
    minusSignals: (prop(page, 'Muted') || []).map(norm).filter(Boolean),
    languages: prop(page, 'Languages') || [],
    windowHours: Number(prop(page, 'Window')) > 0 ? Number(prop(page, 'Window')) : DEFAULTS.windowHours,
    threshold: Number.isFinite(Number(prop(page, 'Threshold'))) ? Number(prop(page, 'Threshold')) : DEFAULTS.threshold,
    priority: prop(page, 'Priority') || '⚡ Medium',
    wantsDiscovery: prop(page, 'Find sources') === true,
    sourceIds: [],
  });
}

const PRIORITY_ORDER = { '🔥 High': 0, '⚡ Medium': 1, '💤 Low': 2 };
topics.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));

const brokenTopics = topics.filter((t) => !t.criterion).map((t) => t.name);
const usableTopics = topics.filter((t) => t.criterion);

// ---------------------------------------------------------------- sources
const byId = new Map(usableTopics.map((t) => [t.id, t]));
const sources = [];
for (const page of pages('Notion: Sources')) {
  const status = prop(page, 'Status');
  if (status !== 'Active' && status !== 'Degrading') continue;  // degraded still gets a chance to recover
  const topicIds = (prop(page, 'Topics') || []).map((r) => String(r).replace(/-/g, ''));
  const linked = topicIds.filter((tid) => byId.has(tid));
  if (linked.length === 0) continue;                            // a source nobody listens to is not fetched
  const source = {
    id: id(page),
    name: prop(page, 'Source') || '(unnamed)',
    url: prop(page, 'Address') || '',
    type: norm(prop(page, 'Type')) || 'rss',
    status,
    failures: Number(prop(page, 'Failures in a row')) || 0,
    topicIds: linked,
  };
  if (!source.url) continue;
  sources.push(source);
  for (const tid of linked) byId.get(tid).sourceIds.push(source.id);
}

// A topic with no live sources cannot produce anything today. It is not an error — it is the trigger
// for source discovery, and the daily brief says so in its footer instead of just coming up short.
const orphanTopics = usableTopics.filter((t) => t.sourceIds.length === 0).map((t) => t.name);

return [{
  json: {
    config,
    topics: usableTopics,
    sources,
    warnings: {
      topics_without_criterion: brokenTopics,
      topics_without_sources: orphanTopics,
    },
    counts: {
      topics_active: usableTopics.length,
      sources_active: sources.length,
    },
  },
}];
