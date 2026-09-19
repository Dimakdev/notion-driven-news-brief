// [35] Survivors become rows; rejects become a line in the message. Both are shown, because "the agent
// invented three feeds that do not exist" is the part that proves the check is real rather than claimed.
//
// Everything lands as `Proposed`. Nothing a model suggested is ever switched on by this workflow.
const d = $input.first().json;
const passed = d.passed || [];
const failed = d.failed || [];

const STRINGS = {
  en: { title: 'Source discovery', passed: 'Passed verification:', perWeek: 'per week', last: 'last',
        inBase: 'They are in the database as Proposed. Set the ones that fit to Active.',
        rejected: 'Rejected:', none: 'No candidates found.' },
  uk: { title: 'Розвідка джерел', passed: 'Пройшли перевірку:', perWeek: 'на тиждень', last: 'останній',
        inBase: 'Вони вже в базі зі статусом Proposed. Постав Active тим, що підходять.',
        rejected: 'Відсіяно:', none: 'Кандидатів не знайшлося.' },
};
const S = STRINGS[(() => { try { return $('Build discovery input').first().json.lang; } catch { return 'en'; } })()] || STRINGS.en;

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 2000) } }] : []);

const rows = passed.map((p) => ({
  json: {
    properties: {
      'Source': { title: rich(p.name) },
      'Address': { url: p.url },
      'Type': { select: { name: p.type } },
      'Status': { select: { name: 'Proposed' } },
      'Proposed by': { select: { name: 'agent' } },
      'Failures in a row': { number: 0 },
      'Items per week': { number: Number(p.per_week) || null },
      'Freshness': p.freshness ? { date: { start: p.freshness } } : { date: null },
      'Note': { rich_text: rich(p.note) },
      'Topics': { relation: p.topic_id ? [{ id: p.topic_id }] : [] },
    },
  },
}));

// The message names numbers the code measured, never numbers the model claimed.
const lines = [`🔍 <b>${S.title}</b>`, '', d.summary || ''];
if (passed.length) {
  lines.push('', `<b>${S.passed}</b>`);
  for (const p of passed) {
    lines.push(`• ${esc(p.name)} - ${esc(p.type)}, ~${p.per_week ?? '?'} ${S.perWeek}, ${S.last} ${esc(p.freshness || 'undated')}`);
  }
  lines.push('', `<i>${S.inBase}</i>`);
}
if (failed.length) {
  lines.push('', `<b>${S.rejected}</b>`);
  for (const f of failed) lines.push(`• ${esc(f.name)} — ${esc(f.rejected)}`);
}
if (!passed.length && !failed.length) lines.push('', S.none);

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
