// [22] A link in the brief was opened. Find the row, note the time, and hand back where to send the
// reader — from the stored row, never from the request.
//
// This is the one node in the workflow that a stranger can reach, so it is written as if someone will
// try: the address always comes out of the archive, so a crafted ?i= cannot turn this into an open
// redirect to somewhere else. The worst a bad hash can do is land on the brief archive.
// Where an unknown hash lands. Deliberately somewhere harmless and constant.
const FALLBACK = 'https://www.notion.so';

const route = $('Route webhook').first().json;
const found = ($input.first().json.results || [])[0];

if (!found) {
  // Unknown hash: still a 302, still somewhere harmless, and it is counted rather than hidden.
  return [{ json: { page_id: null, target: FALLBACK, matched: false, hash: route.hash || null, properties: {} } }];
}

const url = found.properties?.['Link']?.url;
const alreadyOpened = found.properties?.['Opened']?.date?.start;

// Only http(s) is followed. A feed that ever hands us a javascript: or data: address does not get to
// pass it on to the reader's browser.
const safe = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : FALLBACK;

return [{
  json: {
    page_id: found.id,
    target: safe,
    matched: true,
    hash: route.hash || null,
    // First open wins. Re-reading an article a week later should not rewrite when it first landed.
    properties: alreadyOpened ? {} : { 'Opened': { date: { start: DateTime.now().toISO() } } },
    already_opened: !!alreadyOpened,
  },
}];
