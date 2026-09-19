// [17] One row per day. This is where the metrics come from — precision, dead keywords, which source
// actually earns its place — without keeping a row for every article the filter ever looked at.
const d = $input.first().json;
const c = d.counters || {};
const started = d.started_at ? DateTime.fromISO(d.started_at) : null;

// Per source: did it answer, how much did it bring, how much of that survived to the brief. A source
// that answers every morning and has contributed nothing in a month is visible here and nowhere else.
const included = d.items || [];
const perSource = {};
for (const [name, s] of Object.entries(d.per_source || {})) {
  perSource[name] = { ok: !!s.ok, items: Number(s.items || 0), included: 0 };
  if (s.error) perSource[name].error = String(s.error).slice(0, 200);
}
for (const it of included) {
  const name = it.source_name || (d.items_by_source || {})[it.hash];
  if (name && perSource[name]) perSource[name].included += 1;
}

// Signals that fired and signals that never do. A keyword with a zero here for weeks is either dead
// vocabulary or a topic that has drifted — both worth knowing, neither visible any other way.
const signals = {
  hits: c.signal_hits || {},
  muted: c.minus_hits || {},
  score_buckets: d.buckets || {},
};

const errors = [];
if (d.budget?.hit) errors.push(`budget ceiling ${d.budget.ceiling} of ${d.budget.wanted} candidates`);
if (c.no_verdict) errors.push(`${c.no_verdict} items came back without a verdict`);
for (const [name, s] of Object.entries(d.per_source || {})) if (!s.ok) errors.push(`${name}: ${s.error || 'no answer'}`);
for (const p of d.problems || []) errors.push(String(p));
if (d.tracking_enabled === false) errors.push('links not wrapped: Адреса n8n is not public, click tracking off');
for (const t of d.warnings?.topics_without_sources || []) errors.push(`topic without live sources: ${t}`);
for (const t of d.warnings?.topics_without_criterion || []) errors.push(`topic without a criterion, skipped: ${t}`);

return [{
  json: {
    ...d,
    run_row: {
      properties: {
        'Дата': { title: [{ type: 'text', text: { content: d.run_date || DateTime.now().toISODate() } }] },
        'Розглянуто': { number: Number(c.considered || 0) },
        'Відсіяно правилом': { number: Number(c.dropped_by_rule || 0) },
        'Відсіяно моделлю': { number: Number(c.dropped_below_threshold || 0) },
        'Включено': { number: included.length },
        'Джерела JSON': { rich_text: [{ type: 'text', text: { content: JSON.stringify(perSource).slice(0, 2000) } }] },
        'Сигнали JSON': { rich_text: [{ type: 'text', text: { content: JSON.stringify(signals).slice(0, 2000) } }] },
        'Помилки': { rich_text: [{ type: 'text', text: { content: (errors.join(' · ') || '—').slice(0, 2000) } }] },
        'Тривалість': { number: started ? Math.round(DateTime.now().diff(started, 'seconds').seconds) : 0 },
      },
    },
  },
}];
