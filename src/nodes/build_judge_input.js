// [7] Pack the shortlist for the model. One call per chunk of items, with every active topic's
// criterion inside it — not one call per item-and-topic pair, which would multiply the bill by the
// number of topics and let the same article arrive twice under two headings.
//
// Chunking also stops the topic block from being re-sent with every single article: at six topics
// that block is the bulk of the prompt, so sending it once per eight items instead of once per item
// is most of the cost saved.
const CHUNK = 8;              // items per model call. Smaller = safer JSON, larger = cheaper.
const TITLE_MAX = 200;
const SUMMARY_MAX = 400;      // the model judges relevance, not quality: the opening is enough

const items = $input.all().map((i) => i.json);
const head = items.find((j) => j._counters) || items[0] || {};
const topics = head._topics || items[0]?._topics || [];
const config = head._config || items[0]?._config || {};

// The topic block is written once and reused. Criteria are the user's own words from Notion — they are
// data, not instructions: the prompt frames them as descriptions to match against, never as commands.
//
// Topics are labelled t1..tN rather than by their Notion id. A 32-character hex string is something
// models copy wrong or quietly give up on: the first live run handed over real ids and got six verdicts
// back, every one with an empty topic and a reason that plainly described a match. Short labels, mapped
// back in code, removed the failure completely.
const topicBlock = topics.map((t, i) => `- id: t${i + 1}\n  name: ${t.name}\n  wants: ${t.criterion}`).join('\n');
const topicMap = topics.map((t) => t.id);

// The prompt is told the language by name, not by code: a model writes better Ukrainian when
// asked for "Ukrainian" than when handed "uk".
const LANGS = {'en': 'English', 'uk': 'Ukrainian', 'de': 'German', 'fr': 'French', 'es': 'Spanish', 'pl': 'Polish'};
const language = LANGS[(config.lang || 'en')] || 'English';

const chunks = [];
for (let i = 0; i < items.length; i += CHUNK) {
  const slice = items.slice(i, i + CHUNK);
  const articles = slice.map((it, n) => [
    `#${n}`,
    `title: ${String(it.title).slice(0, TITLE_MAX)}`,
    it.domain ? `domain: ${it.domain}` : null,
    it.published_at ? `published: ${it.published_at}` : null,
    it.summary_raw ? `excerpt: ${String(it.summary_raw).slice(0, SUMMARY_MAX)}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');

  chunks.push({
    json: {
      chunk_index: chunks.length,
      // keys back to the real items; the model only ever sees #0..#7
      item_hashes: slice.map((it) => it.url_hash),
      topic_map: topicMap,
      prompt_topics: topicBlock,
      prompt_articles: articles,
      expected: slice.length,
      prompt_language: language,
      _config: config,
      _topics: topics,
      ...(chunks.length === 0 ? {
        _counters: head._counters,
        _per_source: head._per_source,
        _budget: head._budget,
        _all_items: items,
      } : {}),
    },
  });
}

return chunks;
