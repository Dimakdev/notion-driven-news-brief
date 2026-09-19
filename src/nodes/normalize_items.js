// [5] Everything a source returned becomes the same shape here. Both lanes land in this node: the xml
// lane arrives already parsed by n8n's XML node, the json lane arrives as the API's own object.
// After this node nothing downstream knows or cares what kind of source an item came from.
const SUMMARY_MAX = 600;   // enough for the model to judge, short enough to keep the batch cheap

// Query parameters that identify the campaign, not the article. Stripping them before hashing is what
// makes "the same story shared twice" one row instead of two.
const TRACKING = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|igshid|_hsenc|_hsmi|source)/i;

function canonicalUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
    u.protocol = 'https:';
    for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return String(raw || '').trim();
  }
}

// FNV-1a. No crypto import, no dependency, same answer on every n8n version — which matters because
// this hash IS the memory of what was already sent. Change the algorithm and yesterday comes back.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const stripHtml = (s) => String(s || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')
  .trim();

const text = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? v._ ?? v.$t ?? v.href ?? v['@href'] ?? '');
  return String(v);
};

const arr = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

function isoDate(v) {
  const raw = text(v);
  if (!raw) return null;
  const dt = DateTime.fromISO(raw, { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();
  const rfc = DateTime.fromRFC2822(raw, { setZone: true });      // RSS pubDate is RFC-822
  if (rfc.isValid) return rfc.toUTC().toISO();
  const loose = DateTime.fromJSDate(new Date(raw));
  return loose.isValid ? loose.toUTC().toISO() : null;
}

// ---------------------------------------------------------------- per-format readers
function readRss(body) {
  const channel = body?.rss?.channel ?? body?.channel ?? {};
  return arr(channel.item).map((it) => ({
    title: stripHtml(text(it.title)),
    url: text(it.link) || text(it.guid),
    summary: stripHtml(text(it.description) || text(it['content:encoded'])),
    published: isoDate(it.pubDate ?? it.published ?? it['dc:date']),
  }));
}

function readAtom(body) {
  const feed = body?.feed ?? {};
  return arr(feed.entry).map((e) => {
    // Atom puts the address in an attribute; the XML node may expose it as href, @href or $.href.
    const link = arr(e.link).map((l) => text(l.href ?? l['@href'] ?? l?.$?.href ?? l)).find(Boolean);
    return {
      title: stripHtml(text(e.title)),
      url: link || text(e.id),
      summary: stripHtml(text(e.summary) || text(e.content) || text(e['media:group']?.['media:description'])),
      published: isoDate(e.published ?? e.updated),
    };
  });
}

function readReddit(body) {
  return arr(body?.data?.children).map((c) => {
    const d = c.data || {};
    return {
      title: stripHtml(d.title),
      // For a link post the interesting address is the target, not the comment thread.
      url: d.url_overridden_by_dest || d.url || `https://www.reddit.com${d.permalink || ''}`,
      summary: stripHtml(d.selftext || ''),
      published: d.created_utc ? DateTime.fromSeconds(Number(d.created_utc)).toUTC().toISO() : null,
    };
  });
}

// ---------------------------------------------------------------- main
const out = [];
const perSource = {};

for (const item of $input.all()) {
  const j = item.json;
  // The source metadata rides along from [3]; a failed fetch is marked by [4] and carries no body.
  const meta = j._source || j;
  const failed = j._fetch_failed === true;
  const stat = (perSource[meta.name] = perSource[meta.name] || { ok: !failed, items: 0, error: j._fetch_error || null });

  if (failed) continue;

  const body = j._body ?? j.data ?? j;
  let raw = [];
  try {
    if (meta.type === 'reddit') raw = readReddit(body);
    else if (meta.type === 'json') raw = readReddit(body);          // generic JSON uses the same shape by convention
    else if (body?.feed) raw = readAtom(body);                       // atom and youtube
    else raw = readRss(body);                                        // rss and hn
  } catch (e) {
    stat.ok = false;
    stat.error = `parse failed: ${e.message}`;
    continue;
  }

  for (const r of raw) {
    if (!r.title || !r.url) continue;
    const url = canonicalUrl(r.url);
    let domain = '';
    try { domain = new URL(url).hostname; } catch { domain = ''; }
    out.push({
      json: {
        source_id: meta.id,
        source_name: meta.name,
        source_type: meta.type,
        topic_ids: meta.topicIds || [],
        title: r.title,
        url,
        url_hash: hash(url),
        // A Hacker News entry is a pointer, not an article: the domain is often the only clue about
        // what is actually behind it, so it is kept and shown to the model.
        domain,
        summary_raw: (r.summary || '').slice(0, SUMMARY_MAX),
        published_at: r.published,
        _config: meta._config || j._config,
        _topics: meta._topics || j._topics,
      },
    });
    stat.items += 1;
  }
}

if (out.length === 0) {
  return [{ json: { empty: true, per_source: perSource } }];
}

// The per-source tally travels on the first item; [11] folds it into the daily Runs row.
out[0].json._per_source = perSource;
return out;
