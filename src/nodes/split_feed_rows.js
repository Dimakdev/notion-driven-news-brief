// [15] Fan the archive rows out, one per item, now that the brief page exists and can be linked to.
//
// The brief page is created first on purpose: every row points back at the morning it arrived in, so
// the archive reads both ways — a day to its items, an item to its day.
const created = $input.first().json;              // the Notion response for the brief page
const source = $('Build Notion rows').first().json;
const briefId = created.id || null;

const rows = source.feed_rows || [];
if (rows.length === 0) {
  return [{ json: { ...source, brief_page_id: briefId, no_rows: true } }];
}

return rows.map((row, i) => ({
  json: {
    properties: {
      ...row.properties,
      ...(briefId ? { 'Бриф': { relation: [{ id: briefId }] } } : {}),
    },
    _hash: row._hash,
    _brief_page_id: briefId,
    // carried on the first item so the nodes after the loop still have the whole picture
    ...(i === 0 ? { _digest: source } : {}),
  },
}));
