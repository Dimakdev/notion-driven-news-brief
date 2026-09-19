// [16] Write the seen-index — and only now, after the brief has actually been delivered.
//
// This node is the reason a crashed run costs nothing. Everything upstream is read-only against the
// index: if the model times out, if Telegram is down, if Notion rejects a write, tomorrow's run sees
// the same articles as new and tries again. The index moves forward only when a human got the brief.
// NOT $input: the node before this one is the Telegram send, and a messenger node replaces the item
// with the API's answer. Reading the input here meant `items` was always empty, so nothing was ever
// marked as seen and every article would have come back the next morning — the exact failure this
// index exists to prevent, and silent enough to survive a week unnoticed.
const d = $('Build Notion rows').first().json;
const store = $getWorkflowStaticData('global');
const today = DateTime.now();
const iso = today.toISODate();

store.seen = store.seen || {};

// Mark what shipped. Only these: an article the filter rejected is not "seen", it is "not wanted
// today" — tomorrow it may match a topic the user edits tonight.
let added = 0;
for (const it of d.items || []) {
  if (!it.hash) continue;
  if (!store.seen[it.hash]) added += 1;
  store.seen[it.hash] = iso;
}

// Rolling window. Hashes are tiny, but unbounded growth in workflow static data is a slow leak that
// would surface months later as a workflow that will not save.
const keepDays = Number(d.config?.memoryDays) || 30;
const cutoff = today.minus({ days: keepDays }).toISODate();
let pruned = 0;
for (const [hash, when] of Object.entries(store.seen)) {
  if (String(when) < cutoff) { delete store.seen[hash]; pruned += 1; }
}

store.last_run = { date: iso, included: (d.items || []).length, considered: d.counters?.considered || 0 };

return [{
  json: {
    ...d,
    seen_index: { added, pruned, size: Object.keys(store.seen).length, window_days: keepDays },
  },
}];
