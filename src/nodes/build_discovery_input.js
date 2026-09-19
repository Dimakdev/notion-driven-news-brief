// [31] Source discovery, step one: which topics are asking, and what do they already have.
//
// Runs every quarter of an hour against one cheap Notion query. A topic asks either by having its
// `Find sources` box ticked, or by having no live sources at all — the system noticing a hole
// before the person does.
const MAX_CANDIDATES = 8;

function pages(nodeName) {
  const out = [];
  for (const item of $(nodeName).all()) {
    const j = item.json || {};
    if (Array.isArray(j.results)) out.push(...j.results);
    else if (j.id || j.properties) out.push(j);
  }
  return out;
}

function prop(page, name) {
  const p = (page.properties || {})[name];
  if (!p) return null;
  switch (p.type) {
    case 'title': return (p.title || []).map((t) => t.plain_text).join('');
    case 'rich_text': return (p.rich_text || []).map((t) => t.plain_text).join('');
    case 'select': return p.select ? p.select.name : null;
    case 'multi_select': return (p.multi_select || []).map((o) => o.name);
    case 'checkbox': return p.checkbox;
    case 'url': return p.url;
    case 'relation': return (p.relation || []).map((r) => r.id);
    default: return p[p.type] ?? null;
  }
}

const id = (p) => String(p.id || '').replace(/-/g, '');

// What each topic already reads, so the model does not spend its answer proposing what is there.
const urlsByTopic = new Map();
const liveCount = new Map();
for (const s of pages('Notion: Sources (discovery)')) {
  const status = prop(s, 'Status');
  const url = prop(s, 'Address');
  for (const rel of prop(s, 'Topics') || []) {
    const tid = String(rel).replace(/-/g, '');
    if (!urlsByTopic.has(tid)) urlsByTopic.set(tid, []);
    if (url) urlsByTopic.get(tid).push(url);
    if (status === 'Active') liveCount.set(tid, (liveCount.get(tid) || 0) + 1);
  }
}

// The report is written in the reader's language, like the brief itself.
let settingsLang = 'en';
try {
  for (const r of pages('Notion: Settings (discovery)')) {
    const k = String(prop(r, 'Key') || '').trim().toLowerCase();
    if (k === 'brief language') settingsLang = String(prop(r, 'Value') || 'en').trim().toLowerCase().slice(0, 2);
  }
} catch { settingsLang = 'en'; }

const out = [];
for (const t of pages('Notion: Topics (discovery)')) {
  if (prop(t, 'Status') !== 'Active') continue;
  const tid = id(t);
  const asked = prop(t, 'Find sources') === true;
  const starving = (liveCount.get(tid) || 0) === 0;
  if (!asked && !starving) continue;

  const criterion = (prop(t, 'Criterion') || '').trim();
  if (!criterion) continue;   // nothing to search for; [6] already names such topics in the run row

  out.push({
    json: {
      topic_id: tid,
      topic_page_id: t.id,
      topic_name: prop(t, 'Topic'),
      asked_explicitly: asked,
      prompt_topic: `name: ${prop(t, 'Topic')}\nwants: ${criterion}`,
      prompt_languages: (prop(t, 'Languages') || ['en']).join(', '),
      prompt_existing: (urlsByTopic.get(tid) || []).join('\n') || '(none yet)',
      max_candidates: MAX_CANDIDATES,
      lang: settingsLang,
    },
  });
}

return out;
