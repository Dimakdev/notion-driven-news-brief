// [3] Turn the source list into one item per HTTP request. The adapter map is the whole reason a new
// kind of source is one row in Notion plus one entry here, and nothing else in the graph changes.
//
// `lane` decides which branch of the Switch the item takes: xml feeds go through n8n's XML node first,
// json feeds go straight to the normalizer. Add a type -> pick a lane -> map its fields. That is it.
const ADAPTERS = {
  rss: { lane: 'xml' },
  atom: { lane: 'xml' },
  // A YouTube channel has a real RSS feed, which is why "watch this channel" costs nothing extra.
  // Accepts a channel id, a full feed url, or a /channel/<id> link.
  youtube: {
    lane: 'xml',
    url: (u) => (u.includes('feeds/videos.xml')
      ? u
      : `https://www.youtube.com/feeds/videos.xml?channel_id=${(u.match(/(UC[\w-]{20,})/) || [, u])[1]}`),
  },
  // Reddit serves JSON on any listing by appending .json — no API key for read-only use.
  reddit: {
    lane: 'json',
    url: (u) => (u.endsWith('.json') ? u : `${u.replace(/\/$/, '')}/new.json?limit=50`),
  },
  // Hacker News titles are written by whoever submitted the link, not by the article's author, so the
  // keyword filter is weaker here. The normalizer keeps the linked article's domain for that reason.
  hn: { lane: 'xml' },
  json: { lane: 'json' },
  // Reserved: used only when a topic has no healthy sources at all. Not fetched on the normal path.
  web_search: { lane: 'skip' },
};

// Some publishers answer a bare client with 403. A plain, honest user agent is enough for the ones
// that only block empty UAs; the ones behind a real anti-bot wall (Cloudflare) stay unreachable and
// that is what the source health counter is for.
const UA = 'Mozilla/5.0 (compatible; notion-driven-news-brief/1.0; +https://github.com/)';

const { config, sources, topics, warnings, counts } = $input.first().json;

if (config.paused) {
  // Pause in Settings: the run ends here, deliberately and visibly, instead of quietly fetching nothing.
  return [{ json: { skip: true, reason: 'paused', config, topics, warnings, counts } }];
}

const plan = [];
for (const source of sources) {
  const adapter = ADAPTERS[source.type];
  if (!adapter || adapter.lane === 'skip') continue;
  plan.push({
    json: {
      ...source,
      lane: adapter.lane,
      fetch_url: adapter.url ? adapter.url(source.url) : source.url,
      headers: { 'User-Agent': UA, Accept: adapter.lane === 'json' ? 'application/json' : 'application/rss+xml, application/xml, text/xml, */*' },
      // carried along so every downstream node can stay stateless
      _config: config,
      _topics: topics,
      _warnings: warnings,
      _counts: counts,
    },
  });
}

if (plan.length === 0) {
  return [{ json: { skip: true, reason: 'no_sources', config, topics, warnings, counts } }];
}

return plan;
