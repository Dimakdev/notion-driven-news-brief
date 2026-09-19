// [6] Stage one: pure code, no model, five checks in order from cheapest to dearest. Around 180 items
// in, around 40 out — those numbers are what the previous five months looked like, not a target.
//
// Reading the seen-index here but NOT writing it is deliberate: if the run dies before delivery, the
// items it looked at must still be new tomorrow. [12] writes the index only after the brief is sent.
const CLUSTER_SIMILARITY = 0.6;   // share of content words two titles must have in common to be one story
const MIN_TOKEN = 4;              // shorter words carry no signal for clustering

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'you', 'are', 'was', 'were',
  'its', 'has', 'have', 'will', 'can', 'new', 'now', 'why', 'how', 'what', 'when', 'about', 'after',
  'says', 'said', 'over', 'more', 'than', 'but', 'not', 'all', 'out', 'up', 'his', 'her', 'their',
]);

const items = $input.all().map((i) => i.json).filter((j) => j && j.url);
if (items.length === 0) {
  return [{ json: { empty: true, reason: 'nothing_fetched' } }];
}

const config = items[0]._config || {};
const topics = items[0]._topics || [];
const perSource = items.find((j) => j._per_source)?._per_source || {};
const byTopic = new Map(topics.map((t) => [t.id, t]));

// Seen-index: { hash: 'YYYY-MM-DD' }. Read-only in this node.
const store = $getWorkflowStaticData('global');
const seen = store.seen || {};

const now = DateTime.now();
const counters = {
  fetched: items.length,
  dropped_out_of_window: 0,
  dropped_already_seen: 0,
  dropped_duplicate: 0,
  dropped_minus_signal: 0,
  dropped_no_signal: 0,
  signal_hits: {},
  minus_hits: {},
};

const bump = (bag, key) => { bag[key] = (bag[key] || 0) + 1; };

function tokens(title) {
  return new Set(
    String(title).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
      .filter((w) => w.length >= MIN_TOKEN && !STOP.has(w)),
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

// ---------------------------------------------------------------- 1 + 2: window and memory
const survivors = [];
for (const it of items) {
  // Widest window among the topics this source serves: a source feeding two topics must not be cut
  // by the stricter one before the looser topic ever sees the item.
  const windows = (it.topic_ids || []).map((id) => byTopic.get(id)?.windowHours).filter(Boolean);
  const windowHours = windows.length ? Math.max(...windows) : 24;

  if (it.published_at) {
    const age = now.diff(DateTime.fromISO(it.published_at), 'hours').hours;
    if (!(age <= windowHours)) { counters.dropped_out_of_window += 1; continue; }
  }
  // No date in the feed is not a reason to drop: some feeds simply do not publish one. The item goes
  // through and the model sees it without a date.

  if (seen[it.url_hash]) { counters.dropped_already_seen += 1; continue; }
  survivors.push({ ...it, _tokens: tokens(it.title) });
}

// ---------------------------------------------------------------- 3: one story, many sources
const clusters = [];
for (const it of survivors) {
  const home = clusters.find((c) => jaccard(c.tokens, it._tokens) >= CLUSTER_SIMILARITY);
  if (home) {
    home.members.push(it);
    // Keep the copy from the source that is closest to the original: a publisher over an aggregator.
    if (home.lead.source_type === 'hn' && it.source_type !== 'hn') home.lead = it;
    counters.dropped_duplicate += 1;
  } else {
    clusters.push({ tokens: it._tokens, lead: it, members: [it] });
  }
}

// ---------------------------------------------------------------- 4 + 5: minus-signals and signals
const candidates = [];
for (const c of clusters) {
  const it = c.lead;
  const haystack = `${it.title} ${it.summary_raw} ${it.domain}`.toLowerCase();
  const itemTopics = (it.topic_ids || []).map((id) => byTopic.get(id)).filter(Boolean);

  // A minus-signal from ANY topic this item could belong to kills it. Muting is absolute by design:
  // "I never want to see this" should not depend on which topic happened to catch it.
  const muted = itemTopics.flatMap((t) => t.minusSignals).find((w) => haystack.includes(w));
  if (muted) { counters.dropped_minus_signal += 1; bump(counters.minus_hits, muted); continue; }

  // A topic with an empty Сигнали list has its keyword filter switched off on purpose: it accepts
  // everything in the window and pays the model to decide.
  const matched = [];
  let openTopic = false;
  for (const t of itemTopics) {
    if (!t.keywordFilter) { openTopic = true; continue; }
    for (const s of t.signals) {
      if (haystack.includes(s)) { matched.push(s); bump(counters.signal_hits, s); }
    }
  }
  if (!openTopic && matched.length === 0) { counters.dropped_no_signal += 1; continue; }

  candidates.push({
    ...it,
    _tokens: undefined,
    duplicates: c.members.length,
    duplicate_sources: [...new Set(c.members.map((m) => m.source_name))],
    matched_signals: [...new Set(matched)],
    candidate_topic_ids: itemTopics.map((t) => t.id),
  });
}

// ---------------------------------------------------------------- budget ceiling (money, not count)
// This is the only number that can cut the list, and it never decides what is worth reading — it
// decides how much we are willing to pay to find out. When it bites, the brief says so out loud.
const PRIORITY_ORDER = { '🔥 High': 0, '⚡ Medium': 1, '💤 Low': 2 };
candidates.sort((a, b) => {
  const pa = Math.min(...a.candidate_topic_ids.map((id) => PRIORITY_ORDER[byTopic.get(id)?.priority] ?? 1));
  const pb = Math.min(...b.candidate_topic_ids.map((id) => PRIORITY_ORDER[byTopic.get(id)?.priority] ?? 1));
  if (pa !== pb) return pa - pb;
  return String(b.published_at || '').localeCompare(String(a.published_at || ''));
});

const ceiling = Number(config.budgetCeiling) || 250;
const budgetHit = candidates.length > ceiling;
const shortlist = budgetHit ? candidates.slice(0, ceiling) : candidates;

counters.considered = items.length;
counters.to_model = shortlist.length;
counters.dropped_by_rule = items.length - shortlist.length;

if (shortlist.length === 0) {
  return [{ json: { empty: true, reason: 'nothing_survived_stage1', counters, per_source: perSource, config, topics } }];
}

return shortlist.map((json, i) => ({
  json: {
    ...json,
    _first: i === 0,
    ...(i === 0 ? {
      _counters: counters,
      _per_source: perSource,
      _budget: { ceiling, hit: budgetHit, wanted: candidates.length },
    } : {}),
  },
}));
