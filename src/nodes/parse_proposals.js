// [32] The model's candidates become one item each, ready to be fetched.
//
// Nothing here trusts the answer. Addresses are only shape-checked so the fetch has something to try;
// whether the thing at the other end is a real, living feed is decided in [34] by actually reading it.
const answers = $input.all();
const requests = (() => { try { return $('Build discovery input').all().map((i) => i.json); } catch { return []; } })();

const out = [];
for (let ci = 0; ci < answers.length; ci++) {
  const req = requests[ci] || {};
  let v = answers[ci].json?.output ?? answers[ci].json?.text ?? answers[ci].json;
  if (typeof v === 'string') { try { v = JSON.parse(v.match(/\{[\s\S]*\}/)?.[0] || v); } catch { v = null; } }
  const list = v?.candidates ?? v?.sources ?? (Array.isArray(v) ? v : null);
  if (!Array.isArray(list)) continue;

  const seen = new Set((req.prompt_existing || '').split('\n').map((u) => u.trim()).filter(Boolean));

  for (const c of list.slice(0, req.max_candidates || 8)) {
    const url = String(c.url || '').trim();
    // Only http(s) is ever fetched. A model that answers with a file: or javascript: address gets
    // nothing, silently, rather than handing the workflow something odd to open.
    if (!/^https?:\/\/\S+$/i.test(url)) continue;
    if (seen.has(url)) continue;

    const type = ['rss', 'atom', 'youtube', 'reddit', 'hn', 'json'].includes(String(c.type || '').toLowerCase())
      ? String(c.type).toLowerCase() : 'rss';

    out.push({
      json: {
        _candidate: {
          name: String(c.name || '').trim().slice(0, 80) || '(без назви)',
          url,
          type,
          why: String(c.why || c.reason || '').trim().slice(0, 200),
          topic_id: req.topic_id,
          topic_page_id: req.topic_page_id,
          topic_name: req.topic_name,
        },
        fetch_url: url,
      },
    });
  }
}

return out;
