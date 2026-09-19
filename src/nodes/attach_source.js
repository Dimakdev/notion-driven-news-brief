// [5b] Put the source back on the item, AFTER parsing.
//
// Two n8n facts make this its own node. An HTTP Request node replaces the item it was given, and the
// XML node replaces it again with whatever it parsed — so by the time a feed is readable, which source
// it came from is gone. Running once per item lets $('Build fetch plan').item resolve the request this
// response belongs to through n8n's own item pairing.
//
// The same node sits on all three lanes: parsed XML, raw JSON, and the rejects from [5a].
const j = $input.item.json;

let source = {};
try {
  source = $('Build fetch plan').item.json;
} catch {
  // Pairing can be lost if a node in between drops it. Better an item without its source name than a
  // crashed run: [6] counts it under an unknown source and the brief still goes out.
  source = { name: '(джерело невідоме)', type: 'rss', topicIds: [] };
}

if (j._fetch_failed === true) {
  return { json: { _source: source, _fetch_failed: true, _fetch_error: j._fetch_error || 'no answer' } };
}

return { json: { _source: source, _fetch_failed: false, _body: j.data ?? j } };
