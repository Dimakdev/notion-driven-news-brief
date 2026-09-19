// [14] Notion payloads for the archive: one page per brief, one row per item that shipped.
//
// Only what was sent is written. The ~170 articles the filter threw out leave their mark as numbers in
// the daily Runs row, not as rows here — that is the difference between an archive a person opens and
// a table that is unusable by spring.
const d = $input.first().json;
const date = DateTime.now();
const iso = date.toISODate();

const rich = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 2000) } }] : []);
const rel = (id) => (id ? [{ id: String(id) }] : []);

// The brief page is created first: every item row links back to it, so the archive reads both ways —
// from a day to its items, and from an item to the morning it arrived in.
const briefPage = {
  properties: {
    'Brief': { title: rich(d.page_title) },
    'Date': { date: { start: iso } },
    'Considered': { number: Number(d.counters?.considered || 0) },
    'Included': { number: Number(d.items?.length || 0) },
  },
  markdown: d.page_markdown,
};

const rows = (d.items || []).map((it) => ({
  properties: {
    'Title': { title: rich(it.title) },
    'Link': { url: it.url || null },
    'Hash': { rich_text: rich(it.hash) },
    'Published': it.published_at ? { date: { start: it.published_at } } : { date: null },
    'Brief date': { date: { start: iso } },
    'Score': { number: Number(it.score) || 0 },
    'Reason': { rich_text: rich(it.reason) },
    'Duplicates': { number: Number(it.duplicates) || 1 },
    'Source': { relation: rel(it.source_id) },
    'Topic': { relation: rel(it.topic_id) },
    // 'Brief' is filled by the next node once the page id exists.
  },
  _hash: it.hash,
}));

return [{ json: { ...d, brief_page: briefPage, feed_rows: rows, run_date: iso } }];
