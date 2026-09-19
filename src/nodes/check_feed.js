// [5a] Is what came back actually a feed? Runs before the XML node, because the XML node's answer to
// "this is not XML" is to throw and take the whole morning with it.
//
// This is not a theoretical guard. VentureBeat's AI feed stopped being a feed and started serving an
// Astro-rendered HTML page at the same address — no 404, no redirect, just a page. Without this check
// one publisher's redesign ends the brief for everyone.
const res = $input.item.json;

// `neverError` on the HTTP node means a bad status arrives as data rather than as an exception.
const status = Number(res.statusCode ?? res.status ?? 200);
const body = res.data ?? res.body ?? res;
const head = String(typeof body === 'string' ? body : '').slice(0, 400).trim();

if (status >= 400) {
  return { json: { _fetch_failed: true, _fetch_error: `HTTP ${status}`, _is_xml: false } };
}
if (!head) {
  return { json: { _fetch_failed: true, _fetch_error: 'порожня відповідь', _is_xml: false } };
}
if (!/^\s*(<\?xml|<rss|<feed|<rdf)/i.test(head)) {
  // Name what it actually is. "не фід: віддає HTML-сторінку" in the source note three weeks later tells
  // you to go find the new address; "parse error" tells you nothing.
  return {
    json: {
      _fetch_failed: true,
      _is_xml: false,
      _fetch_error: /<!doctype html|<html/i.test(head) ? 'не фід: віддає HTML-сторінку' : 'не фід: невідомий формат',
    },
  };
}

// Only the payload goes on, under the name the XML node reads. Anything else set here would be lost:
// the XML node replaces the whole item with what it parsed.
return { json: { data: body, _is_xml: true } };
