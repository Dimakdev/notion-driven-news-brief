// [9] Fold the model's verdicts back onto the real items and apply each topic's threshold.
//
// The rule this node exists to protect: the threshold decides what ships, and nothing decides how
// many. Fifteen articles above the bar means a fifteen-item brief. One means one. None means the
// brief says "nothing today" and stops. There is no cap anywhere below this line.
// A chain node answers with its output and nothing else: the chunk metadata that went in — which
// article each #number is, and which topic each label means — does not come out the other side. The
// chain is one-in one-out, so the request for answer N is request N of the node that built them.
const answers = $input.all().map((i) => i.json);
const requests = $('Build judge input').all().map((i) => i.json);
const head = requests[0] || {};
const allItems = head._all_items || [];
const topics = head._topics || [];
const config = head._config || {};
const byHash = new Map(allItems.map((it) => [it.url_hash, it]));
const byTopic = new Map(topics.map((t) => [t.id, t]));

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n))));

// The structured-output parser usually hands back an object. When a model slips and returns the JSON
// as a string, or wraps it in a fence, this recovers it instead of losing the whole chunk.
function verdictsOf(json) {
  let v = json?.output ?? json?.text ?? json?.data ?? json;
  if (typeof v === 'string') {
    const m = v.match(/\{[\s\S]*\}/);
    try { v = JSON.parse(m ? m[0] : v); } catch { return null; }
  }
  const list = v?.verdicts ?? v?.results ?? (Array.isArray(v) ? v : null);
  return Array.isArray(list) ? list : null;
}

const scored = [];
const problems = [];
let missing = 0;

for (let ci = 0; ci < answers.length; ci++) {
  const chunk = requests[ci] || {};
  const hashes = chunk.item_hashes || [];
  const list = verdictsOf(answers[ci]);
  if (!list) {
    // A whole chunk came back unreadable. Those articles are not silently dropped: they are counted
    // and named in the run row, so a bad morning is visible instead of looking like a quiet day.
    missing += hashes.length;
    problems.push(`chunk ${ci}: unreadable model output`);
    continue;
  }
  const seenIdx = new Set();
  for (const v of list) {
    const idx = Number(v.i ?? v.index ?? v.id);
    if (!Number.isInteger(idx) || idx < 0 || idx >= hashes.length) continue;
    seenIdx.add(idx);
    const item = byHash.get(hashes[idx]);
    if (!item) continue;

    // t1..tN back to the real topic. A raw id is still accepted, in case a model echoes one.
    const label = String(v.topic_id || '').trim();
    const m = label.match(/^t(\d+)$/i);
    const resolved = m ? (chunk.topic_map || [])[Number(m[1]) - 1] : label.replace(/-/g, '');
    const topic = byTopic.get(resolved);
    const score = clamp(v.score ?? 0);
    // No topic means the model found nothing it fits. That is a legitimate answer, not an error.
    if (!topic) continue;

    scored.push({
      ...item,
      score,
      topic_id: topic.id,
      topic_name: topic.name,
      topic_priority: topic.priority,
      threshold: topic.threshold,
      reason: String(v.reason || '').trim().slice(0, 300),
      // The model may put an article under a topic the keyword filter did not suggest. That is an
      // improvement, not a bug: keywords guess, the criterion decides.
      reassigned: !(item.candidate_topic_ids || []).includes(topic.id),
    });
  }
  missing += hashes.filter((_, i) => !seenIdx.has(i)).length;
}

const included = scored
  .filter((s) => s.score >= s.threshold)
  .sort((a, b) => b.score - a.score);

const rejected = scored.filter((s) => s.score < s.threshold);

const counters = {
  ...(head._counters || {}),
  judged: scored.length,
  no_verdict: missing,
  dropped_below_threshold: rejected.length,
  included: included.length,
};

// Score distribution: the honest way to tune the Threshold later. If everything clusters at 55 and the bar is
// 60, the brief looks empty for a reason the user can actually see.
const buckets = { '0-39': 0, '40-59': 0, '60-79': 0, '80-100': 0 };
for (const s of scored) {
  if (s.score < 40) buckets['0-39'] += 1;
  else if (s.score < 60) buckets['40-59'] += 1;
  else if (s.score < 80) buckets['60-79'] += 1;
  else buckets['80-100'] += 1;
}

return [{
  json: {
    included,
    counters,
    score_buckets: buckets,
    problems,
    config,
    topics,
    per_source: head._per_source || {},
    budget: head._budget || { hit: false },
  },
}];
