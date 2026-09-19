// [41] The weekly review. The only place in the whole system where the person is asked to press
// something — and it asks after the reading has happened, not before.
//
// It shows the week's items, marks which ones were opened, and offers one button per unopened item.
// Switched off with a single field in Налаштування; when off, the filter keeps learning from clicks
// alone and nobody is nagged.
const MAX_LINES = 25;   // one Telegram message; a longer week links to the archive instead

// The few words this node writes itself. The digest's language is a row in Settings; adding another
// language is a row here and nothing else anywhere.
const STRINGS = {
  en: { title: 'The week in numbers', sent: 'sent', opened: 'opened',
        allGood: 'You opened everything that arrived. The filter is working - nothing to change.',
        notOpened: 'These you did not open:', andMore: 'and', rest: 'more - the rest is in the archive',
        mark: 'Mark the ones that were noise in Feed - the Verdict field.',
        noPressure: 'Marking nothing is also an answer: the click counts itself, with no tapping at all.' },
  uk: { title: 'Тиждень у цифрах', sent: 'надіслано', opened: 'відкрито',
        allGood: 'Усе, що приходило, ти відкривав. Фільтр працює - правити нічого.',
        notOpened: 'Це ти не відкрив:', andMore: 'і ще', rest: '- решта в архіві',
        mark: 'Познач у Стрічці ті, що були мимо - поле Вердикт.',
        noPressure: 'Не позначати теж відповідь: клік рахується сам, без жодного натискання.' },
};
const S = STRINGS[(() => { try { return $('Gate').first().json.config.lang; } catch { return 'en'; } })()] || STRINGS.en;

// The week's shipped items, straight off a Notion query of Стрічка.
function prop(page, name) {
  const p = (page.properties || {})[name];
  if (!p) return null;
  switch (p.type) {
    case 'title': return (p.title || []).map((x) => x.plain_text).join('');
    case 'rich_text': return (p.rich_text || []).map((x) => x.plain_text).join('');
    case 'select': return p.select ? p.select.name : null;
    case 'date': return p.date ? p.date.start : null;
    default: return p[p.type] ?? null;
  }
}

const pages = [];
for (const item of $input.all()) {
  const j = item.json || {};
  if (Array.isArray(j.results)) pages.push(...j.results);
  else if (j.id || j.properties) pages.push(j);
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const items = pages.map((p) => ({
  page_id: p.id,
  hash: prop(p, 'Hash'),
  title: prop(p, 'Title'),
  opened: !!prop(p, 'Opened'),
  verdict: prop(p, 'Verdict'),
})).filter((i) => i.hash);

const opened = items.filter((i) => i.opened);
const unjudged = items.filter((i) => !i.opened && !i.verdict);

if (items.length === 0) {
  return [{ json: { skip: true, reason: 'nothing shipped this week' } }];
}

const rate = Math.round((opened.length / items.length) * 100);
const lines = [
  `📋 <b>${S.title}</b>`,
  '',
  `${S.sent} ${items.length} · ${S.opened} ${opened.length} (${rate}%)`,
];

if (unjudged.length === 0) {
  lines.push('', S.allGood);
  return [{ json: { skip: false, text: lines.join('\n'), buttons: [] } }];
}

lines.push('', `<b>${S.notOpened}</b>`);

const shown = unjudged.slice(0, MAX_LINES);
shown.forEach((it, n) => lines.push(`${n + 1}. ${esc(it.title)}`));
if (unjudged.length > shown.length) {
  lines.push('', `<i>${S.andMore} ${unjudged.length - shown.length} ${S.rest}</i>`);
}

// No buttons, and the second reason is the real one.
//
// Telegram's node fixes its keyboard at build time, so a list that is eight items one week and two
// the next cannot be a row of buttons without contortions. And a callback needs n8n on a public
// address, which a local install does not have — a feature that works only for some readers is worse
// than one that works the same for everyone.
//
// Marking the verdict in Feed is also more in keeping with the rest of the system: the control
// panel is the database. Open it, set `Verdict` to `miss` on what was noise, done.
lines.push('', `<i>${S.mark}</i>`);
lines.push(`<i>${S.noPressure}</i>`);

return [{
  json: {
    skip: false,
    text: lines.join('\n'),
    stats: { shipped: items.length, opened: opened.length, open_rate: rate, unjudged: unjudged.length },
  },
}];
