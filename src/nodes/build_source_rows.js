// [35] Survivors become rows; rejects become a line in the message. Both are shown, because "the agent
// invented three feeds that do not exist" is the part that proves the check is real rather than claimed.
//
// Everything lands as `Запропоновано`. Nothing a model suggested is ever switched on by this workflow.
const d = $input.first().json;
const passed = d.passed || [];
const failed = d.failed || [];

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 2000) } }] : []);

const rows = passed.map((p) => ({
  json: {
    properties: {
      'Джерело': { title: rich(p.name) },
      'Адреса': { url: p.url },
      'Тип': { select: { name: p.type } },
      'Статус': { select: { name: 'Запропоновано' } },
      'Хто запропонував': { select: { name: 'агент' } },
      'Поспіль невдач': { number: 0 },
      'Записів на тиждень': { number: Number(p.per_week) || null },
      'Свіжість': p.freshness ? { date: { start: p.freshness } } : { date: null },
      'Нотатка': { rich_text: rich(p.note) },
      'Теми': { relation: p.topic_id ? [{ id: p.topic_id }] : [] },
    },
  },
}));

// The message names numbers the code measured, never numbers the model claimed.
const lines = [`🔍 <b>Розвідка джерел</b>`, '', d.summary || ''];
if (passed.length) {
  lines.push('', '<b>Пройшли перевірку:</b>');
  for (const p of passed) {
    lines.push(`• ${esc(p.name)} — ${esc(p.type)}, ~${p.per_week ?? '?'} на тиждень, останній ${esc(p.freshness || 'без дати')}`);
  }
  lines.push('', '<i>Вони вже в базі зі статусом «Запропоновано». Постав «Активне» тим, що підходять.</i>');
}
if (failed.length) {
  lines.push('', '<b>Відсіяно:</b>');
  for (const f of failed) lines.push(`• ${esc(f.name)} — ${esc(f.rejected)}`);
}
if (!passed.length && !failed.length) lines.push('', 'Кандидатів не знайшлося.');

// One item, so the branch keeps flowing even when every candidate was rejected: the checkbox still
// has to be cleared, otherwise discovery would fire again in fifteen minutes, and again after that.
return [{
  json: {
    source_rows: rows.map((r) => r.json),
    message: lines.filter((l) => l !== '' || true).join('\n'),
    passed_count: passed.length,
    failed_count: failed.length,
    topic_page_ids: [...new Set(passed.concat(failed).map((x) => x.topic_page_id).filter(Boolean))],
  },
}];
