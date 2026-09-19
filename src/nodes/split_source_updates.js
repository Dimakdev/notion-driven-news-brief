// [19] One item per source whose row needs touching: a success date, a failure counter, a status
// change. Sources that neither succeeded nor failed this run are not in the list and are left alone.
const d = $input.first().json;
const updates = d.source_updates || [];

// Nothing to update means nothing goes downstream. Returning a placeholder item would send the next
// node a PATCH to /pages/undefined, which answers 400 and looks like a broken payload rather than an
// empty list — an hour of reading the wrong thing.
if (updates.length === 0) {
  return [];
}

return updates.map((u, i) => ({
  json: {
    page_id: u.page_id,
    properties: u.properties,
    ...(i === 0 ? { _health_notes: d.health_notes || [], _orphaned: d.orphaned_topics || [] } : {}),
  },
}));
