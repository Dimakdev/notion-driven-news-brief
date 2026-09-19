// [18] Source health. The answer to the worst failure mode this kind of system has: a feed quietly
// stops answering, the brief gets thinner, and it reads like "not much happened today" for weeks.
//
// A source never dies silently here. It walks through states the user can see, and the day it starts
// failing the brief says so in its own footer.
const DEGRADE_AT = 3;    // consecutive failures before the source is marked as degrading
const RETIRE_AT = 7;     // ...and before it is retired and discovery is offered for its topics

const d = $input.first().json;
const perSource = d.per_source || {};

// The source list lives where it was read, not in the digest: everything between here and [2] is
// about articles, and dragging the whole source table through it would be carrying luggage for the
// sake of one node.
let sources = [];
let topics = [];
try {
  const cfg = $('Load config').first().json;
  sources = cfg.sources || [];
  topics = cfg.topics || [];
} catch { sources = []; }
const byName = new Map(sources.map((s) => [s.name, s]));
const iso = DateTime.now().toISODate();

const updates = [];
for (const [name, stat] of Object.entries(perSource)) {
  const source = byName.get(name);
  if (!source) continue;

  if (stat.ok) {
    // Recovery is a state change too: a source that answers again goes back to Active from Degrading,
    // and the counter resets. Otherwise one bad week would slowly retire a perfectly good feed.
    if (source.failures > 0 || source.status !== 'Active') {
      updates.push({
        page_id: source.id,
        properties: {
          'Last success': { date: { start: iso } },
          'Failures in a row': { number: 0 },
          'Status': { select: { name: 'Active' } },
        },
        _log: `${name}: recovered`,
      });
    } else {
      updates.push({
        page_id: source.id,
        properties: { 'Last success': { date: { start: iso } } },
        _log: null,
      });
    }
    continue;
  }

  const failures = Number(source.failures || 0) + 1;
  let status = source.status;
  let log = null;
  if (failures >= RETIRE_AT) {
    status = 'Retired';
    log = `${name}: retired after ${failures} failed runs`;
  } else if (failures >= DEGRADE_AT) {
    status = 'Degrading';
    log = `${name}: silent for ${failures} runs`;
  }

  updates.push({
    page_id: source.id,
    properties: {
      'Failures in a row': { number: failures },
      'Status': { select: { name: status } },
      'Note': { rich_text: [{ type: 'text', text: {
        content: `${iso}: ${String(stat.error || 'no answer').slice(0, 300)}`,
      } }] },
    },
    _log: log,
  });
}

// Topics whose sources all died. This is the trigger for discovery: the system noticed the hole before
// the user did, and says so rather than serving an empty section.
const retiredIds = new Set(updates.filter((u) => u.properties['Status']?.select?.name === 'Retired').map((u) => u.page_id));
const orphaned = (topics || [])
  .filter((t) => t.sourceIds?.length && t.sourceIds.every((id) => retiredIds.has(id)))
  .map((t) => t.name);

return [{ json: { ...d, source_updates: updates, health_notes: updates.map((u) => u._log).filter(Boolean), orphaned_topics: orphaned } }];
