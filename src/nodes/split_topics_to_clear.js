// [37] Untick «Find sources» on every topic that asked. Done whether or not anything was found:
// an unanswered request that stays ticked turns a one-off into a loop every quarter of an hour.
const ids = (() => {
  try { return $('Build source rows').first().json.topic_page_ids || []; } catch { return []; }
})();

if (ids.length === 0) return [];
return ids.map((page_id) => ({ json: { page_id } }));
