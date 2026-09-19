// [33] Source discovery, step two: the part that makes the first part safe.
//
// Every candidate has just been fetched for real. Here it either parses, is alive, and is new — or it
// does not reach the database at all. The model proposes, this code checks, the person approves. That
// order is the whole trust story of the case, and it is worth saying out loud in the README.
const MIN_ITEMS = 3;            // a feed with one entry is a landing page, not a source
const MAX_STALE_DAYS = 14;      // last entry older than this means the feed is abandoned
const now = DateTime.now();

// The fetch replaced each item with its response, so the candidate it belongs to is read back from
// the node that proposed it, by position — same pairing problem as everywhere else in this workflow.
const proposals = (() => { try { return $('Parse proposals').all().map((i) => i.json._candidate || {}); } catch { return []; } })();

const results = [];
const all = $input.all();
for (let i = 0; i < all.length; i++) {
  const j = all[i].json;
  const c = proposals[i] || j._candidate || {};
  const verdict = { name: c.name || '(unnamed)', url: c.url || '', type: c.type || 'rss',
                    topic_id: c.topic_id, topic_page_id: c.topic_page_id, why: c.why || '' };

  // 1. did it answer at all
  const status = Number(j.statusCode ?? j.status ?? 200);
  if (j._fetch_failed || status >= 400) {
    results.push({ ...verdict, ok: false, rejected: `no answer: ${j._fetch_error || 'HTTP ' + status}` });
    continue;
  }

  // 2. does it parse into entries. The body arrives as text, so the check is done on the raw markup:
  // running it through the XML node first would mean one invented address throwing and taking the
  // whole discovery run with it — the same failure a dead feed caused on the daily path.
  const raw = String(j.data ?? j.body ?? '');
  if (/^\s*(<!doctype html|<html)/i.test(raw.trim())) {
    results.push({ ...verdict, ok: false, rejected: 'not a feed: serves an HTML page' });
    continue;
  }
  const list = raw.match(/<item[\s>]|<entry[\s>]/gi) || [];
  if (list.length < MIN_ITEMS) {
    results.push({ ...verdict, ok: false, rejected: `does not look like a feed: ${list.length} entries` });
    continue;
  }

  // 3. is it still alive
  // The capture keeps its closing '<', and a lone '<' is not a tag, so stripping tags alone leaves it
  // on the end and every date fails to parse. It showed up as "last: undated" on six live feeds.
  const dates = (raw.match(/<(?:pubDate|published|updated)>([^<]+)</g) || []).map((m) => {
    const v = m.replace(/^<[^>]*>/, '').replace(/<$/, '').trim();
    const iso = DateTime.fromISO(v, { setZone: true });
    return iso.isValid ? iso : DateTime.fromRFC2822(v, { setZone: true });
  }).filter((d) => d && d.isValid);

  const newest = dates.length ? DateTime.max(...dates) : null;
  const staleDays = newest ? Math.round(now.diff(newest, 'days').days) : null;
  if (staleDays !== null && staleDays > MAX_STALE_DAYS) {
    results.push({ ...verdict, ok: false, rejected: `silent for ${staleDays} days` });
    continue;
  }

  // 4. how much it actually publishes — a measured number, not the model's guess
  const oldest = dates.length ? DateTime.min(...dates) : null;
  const spanDays = oldest && newest ? Math.max(1, now.diff(oldest, 'days').days) : null;
  const perWeek = spanDays ? Math.round((list.length / spanDays) * 7) : null;

  results.push({
    ...verdict,
    ok: true,
    items_seen: list.length,
    per_week: perWeek,
    freshness: newest ? newest.toISODate() : null,
    // Goes into the Note so the row explains itself a year later.
    note: `Proposed by the agent on ${now.toISODate()}. ${c.why || ''} Verified: ${list.length} entries, ~${perWeek ?? '?'} per week, last ${newest ? newest.toISODate() : 'undated'}.`.trim(),
  });
}

const passed = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

return [{
  json: {
    passed,
    failed,
    summary: `${results.length} proposed, ${passed.length} passed verification`,
    // Rejections are shown too. Seeing "invented three feeds that do not exist" is part of what makes
    // the check visible rather than a claim in a README.
    rejected_lines: failed.map((f) => `${f.name} — ${f.rejected}`),
  },
}];
