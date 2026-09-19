// [10] Only what passed the threshold gets written up. This is the second half of the funnel and the
// reason it exists: judging is cheap and happens to ~40 articles, writing is dear and happens to the
// handful that earned it. Doing both in one pass would pay full price for everything thrown away.
const CHUNK = 5;
const SUMMARY_MAX = 500;

const { included, counters, config, topics, per_source, budget, score_buckets, problems } = $input.first().json;

if (!included || included.length === 0) {
  // An honest empty brief. Not an error, not something to pad — the day simply had nothing above the bar.
  return [{ json: { nothing_today: true, counters, config, topics, per_source, budget, score_buckets, problems, included: [] } }];
}

// The prompt is told the language by name, not by code: a model writes better Ukrainian when
// asked for "Ukrainian" than when handed "uk".
const LANGS = {'en': 'English', 'uk': 'Ukrainian', 'de': 'German', 'fr': 'French', 'es': 'Spanish', 'pl': 'Polish'};
const language = LANGS[(config.lang || 'en')] || 'English';

const chunks = [];
for (let i = 0; i < included.length; i += CHUNK) {
  const slice = included.slice(i, i + CHUNK);
  chunks.push({
    json: {
      chunk_index: chunks.length,
      item_hashes: slice.map((it) => it.url_hash),
      prompt_articles: slice.map((it, n) => [
        `#${n}`,
        `title: ${it.title}`,
        `topic: ${it.topic_name}`,
        it.domain ? `domain: ${it.domain}` : null,
        it.summary_raw ? `excerpt: ${String(it.summary_raw).slice(0, SUMMARY_MAX)}` : null,
        `matched_because: ${it.reason}`,
      ].filter(Boolean).join('\n')).join('\n\n'),
      expected: slice.length,
      prompt_language: language,
      ...(chunks.length === 0 ? {
        _included: included, _counters: counters, _config: config, _topics: topics,
        _per_source: per_source, _budget: budget, _buckets: score_buckets, _problems: problems,
      } : {}),
    },
  });
}

return chunks;
