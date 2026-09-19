// [44] Put «Розбір зараз» back to «ні» once the review has gone out, so asking for it early is a
// one-shot rather than something that repeats every morning until noticed.
const found = ($input.first().json.results || [])[0];
if (!found) return [];

return [{
  json: {
    page_id: found.id,
    properties: { 'Значення': { rich_text: [{ type: 'text', text: { content: 'ні' } }] } },
  },
}];
