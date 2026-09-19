// [12] Build the message and the archive page from the same data.
//
// Everything here that looks like a style rule is one: they came out of five months of the routine
// this case replaces, and they are the difference between a digest someone reads and one they mute.
const MAX_TELEGRAM = 4096;     // hard platform limit; the page link is what makes it irrelevant
const PRIORITY_ORDER = { '🔥 High': 0, '⚡ Medium': 1, '💤 Low': 2 };

const first = $input.first().json;
// The digest payload rides on the first writer request, not on the chain's answer.
let head = first;
try {
  head = $('Build writer input').all().map((i) => i.json).find((j) => j._included || j.nothing_today) || first;
} catch { head = first; }
const included = head._included || first.included || [];
const counters = head._counters || head.counters || first.counters || {};
const config = head._config || head.config || first.config || {};
const perSource = head._per_source || head.per_source || first.per_source || {};
const budget = head._budget || head.budget || first.budget || { hit: false };
const buckets = head._buckets || head.score_buckets || first.score_buckets || {};
const problems = [...(head._problems || head.problems || first.problems || [])];

const publicBase = String(config.publicBase || 'http://localhost:5678').replace(/\/$/, '');

// Click tracking needs an address the outside world can reach. On localhost it is worse than useless:
// Telegram refuses to turn a localhost href into a link at all, so the reader gets the words
// "Читати оригінал" as plain text and no way to open anything. When the address is not public the
// wrapper is dropped and links point straight at the article. The counter is lost, the reading is not.
const trackable = !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(publicBase);
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const date = DateTime.now().toFormat('dd.MM.yyyy');

// ---------------------------------------------------------------- merge the written text back in
// The writer returns Ukrainian title, two or three sentences, and the "why it matters" line. When it
// fails for an item we still ship the item with its original title: a missing paragraph is a smaller
// loss than a missing article.
// Same as in [9]: the chain answers with its output only, so which article each #number refers to is
// read back from the node that built the request, matched by position.
const written = new Map();
const writerRequests = (() => { try { return $('Build writer input').all().map((i) => i.json); } catch { return []; } })();
const answers = $input.all();
for (let ci = 0; ci < answers.length; ci++) {
  let v = answers[ci].json?.output ?? answers[ci].json?.text ?? answers[ci].json;
  if (typeof v === 'string') { try { v = JSON.parse(v.match(/\{[\s\S]*\}/)?.[0] || v); } catch { v = null; } }
  const list = v?.items ?? v?.results ?? (Array.isArray(v) ? v : null);
  const hashes = (writerRequests[ci] || {}).item_hashes || [];
  if (!Array.isArray(list)) continue;
  for (const w of list) {
    const idx = Number(w.i ?? w.index);
    if (!Number.isInteger(idx) || !hashes[idx]) continue;
    written.set(hashes[idx], {
      title: String(w.title_uk || w.title || '').trim(),
      summary: String(w.summary_uk || w.summary || '').trim(),
      // "💡 Чому це важливо" is printed only when the model had something real to say. A forced line
      // here is worse than no line: it teaches the reader to skip the section.
      why: String(w.why || w.why_it_matters || '').trim(),
    });
  }
}

// ---------------------------------------------------------------- nothing today
if (included.length === 0) {
  const text = `🌅 <b>Бриф ${date}</b>\n\nСьогодні нічого не перетнуло поріг.\n\n<i>${counters.considered || 0} прочитано · 0 включено</i>`;
  return [{ json: { nothing_today: true, telegram_text: text, page_title: `🌅 Бриф ${date}`,
    page_markdown: `Сьогодні нічого не перетнуло поріг.\n\n${counters.considered || 0} прочитано · 0 включено.`,
    items: [], counters, config, per_source: perSource, budget, buckets, problems } }];
}

// ---------------------------------------------------------------- group by topic, sort by score
const groups = new Map();
for (const it of included) {
  if (!groups.has(it.topic_id)) groups.set(it.topic_id, { name: it.topic_name, priority: it.topic_priority, items: [] });
  groups.get(it.topic_id).items.push(it);
}
const ordered = [...groups.values()].sort(
  (a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1) || a.name.localeCompare(b.name),
);
for (const g of ordered) g.items.sort((a, b) => b.score - a.score);
const showHeadings = ordered.length > 1;

// ---------------------------------------------------------------- footer
// The footer is where the system admits things. Everything that could make the brief quietly thinner
// than it should be gets a line here, so "нічого цікавого" never hides a broken source or a ceiling.
const footer = [`${counters.considered || 0} прочитано · ${included.length} включено`];
const silent = Object.entries(perSource).filter(([, s]) => !s.ok).map(([name]) => name);
if (silent.length) footer.push(`джерела мовчать: ${silent.join(', ')}`);
if (budget.hit) footer.push(`розглянуто ${budget.ceiling} з ${budget.wanted} — стеля бюджету`);
if (counters.no_verdict) footer.push(`без вердикту: ${counters.no_verdict}`);
if (problems.length) footer.push(problems.join('; '));

// ---------------------------------------------------------------- render
const tg = [`🌅 <b>Бриф ${date}</b>`];
const md = [];
const rows = [];
let n = 0;

for (const g of ordered) {
  if (showHeadings) { tg.push('', `<b>${esc(g.name)}</b>`); md.push(`## ${g.name}`); }
  for (const it of g.items) {
    n += 1;
    const w = written.get(it.url_hash) || {};
    const title = w.title || it.title;
    const summary = w.summary || '';
    const track = trackable ? `${publicBase}/webhook/r?i=${encodeURIComponent(it.url_hash)}` : it.url;

    const block = [`${n}. <b>${esc(title)}</b>`];
    if (summary) block.push(esc(summary));
    if (w.why) block.push(`💡 <i>${esc(w.why)}</i>`);
    if (it.duplicates > 1) block.push(`<i>також у: ${esc(it.duplicate_sources.filter((s) => s !== it.source_name).join(', '))}</i>`);
    block.push(`🔗 <a href="${esc(track)}">Читати оригінал</a>`);
    tg.push('', block.join('\n'));

    md.push(`### ${n}. ${title}`);
    if (summary) md.push(summary);
    if (w.why) md.push(`💡 ${w.why}`);
    md.push(`Джерело: ${it.source_name} · бал ${it.score} · збіг: ${it.reason}`);
    md.push(`[Читати оригінал](${it.url})`);

    rows.push({
      hash: it.url_hash, title, url: it.url, source_id: it.source_id, topic_id: it.topic_id,
      published_at: it.published_at, score: it.score, reason: it.reason, duplicates: it.duplicates || 1,
    });
  }
}

const pageTitle = `🌅 Бриф ${date}`;
tg.push('', `<i>${esc(footer.join(' · '))}</i>`);
md.push('---', footer.join(' · '));

let telegramText = tg.join('\n');
if (telegramText.length > MAX_TELEGRAM) {
  // Should not happen now that the page carries the long form, but truncating loudly beats a silent
  // Telegram 400 that loses the whole morning.
  telegramText = `${telegramText.slice(0, MAX_TELEGRAM - 120)}\n\n<i>…далі на сторінці брифу</i>`;
  problems.push('telegram limit reached, message truncated');
}

return [{
  json: {
    nothing_today: false,
    telegram_text: telegramText,
    page_title: pageTitle,
    page_markdown: md.join('\n\n'),
    items: rows,
    counters: { ...counters, included: included.length },
    // Not in the brief's own footer: a line every single morning about infrastructure the reader
    // already knows about is nagging. It belongs in the run row, where it is looked up when wanted.
    tracking_enabled: trackable,
    config, per_source: perSource, budget, buckets, problems,
  },
}];
