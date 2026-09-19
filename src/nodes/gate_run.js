// [2] The gate. Fires hourly, reads only the Settings table, and decides whether this is the hour to
// do anything at all.
//
// Why hourly instead of a cron set to 05:00: the premise of the whole case is that the database
// decides, and the time of day is part of that. A cron baked into the node would mean "edit the
// workflow to move your brief", which is exactly what this system exists to avoid. The cost is one
// small Notion query per hour; the Topics and Sources tables are only read when the gate opens.
const norm = (s) => String(s || '').trim().toLowerCase();
const isOn = (v) => ['увімкнено', 'так', 'on', 'true', 'yes', '1'].includes(norm(v));

// One Notion query answers with a single object holding every row in `results`, so the rows are
// unwrapped before reading. Looping the items directly would loop once over the envelope.
const rows = [];
for (const item of $input.all()) {
  const j = item.json || {};
  if (Array.isArray(j.results)) rows.push(...j.results);
  else if (j.id || j.properties) rows.push(j);
}

const settings = {};
for (const row of rows) {
  const p = row.properties || {};
  const key = norm((p['Ключ']?.title || []).map((t) => t.plain_text).join('') || row['Ключ']);
  const val = (p['Значення']?.rich_text || []).map((t) => t.plain_text).join('') || row['Значення'] || '';
  if (key) settings[key] = String(val).trim();
}

const store = $getWorkflowStaticData('global');
const now = DateTime.now();
const today = now.toISODate();

// "Give me the brief now": a POST to /webhook/run-now skips the hour check and the once-a-day guard.
// It exists because a schedule-only workflow cannot be tried without waiting for tomorrow, and it
// turns out to be worth keeping — an on-demand brief is a feature, not only a test hook.
// Referencing a node that did not run in this execution throws, so the check is guarded.
let forced = false;
try { forced = $('Run now').all().length > 0; } catch { forced = false; }

const config = {
  paused: isOn(settings['пауза']),
  briefTime: settings['час брифу'] || '05:00',
  weeklyReview: isOn(settings['тижневий розбір']),
  weeklyReviewDay: norm(settings['день розбору']) || 'неділя',
  reviewNow: isOn(settings['розбір зараз']),
  channel: norm(settings['канал']) || 'telegram',
};

const briefHour = Number(String(config.briefTime).split(':')[0]);
const DAYS = { 'понеділок': 1, 'вівторок': 2, 'середа': 3, 'четвер': 4, 'пʼятниця': 5, "п'ятниця": 5, 'субота': 6, 'неділя': 7 };

// Пауза stops everything, including the weekly review. A holiday should be quiet, not half quiet.
// A forced run ignores it: asking for the brief by hand is an explicit answer to "are you on holiday".
if (config.paused && !forced) {
  return [{ json: { run_brief: false, run_review: false, reason: 'пауза', config } }];
}

// One brief per day even if the hour is hit twice — a manual run, a restart, a clock change. The last
// run date lives in static data next to the seen-index, so it survives a container restart.
const alreadyToday = store.last_run?.date === today;
const runBrief = forced || (Number.isFinite(briefHour) && now.hour === briefHour && !alreadyToday);

// The review rides along with the brief hour on its day, so the person gets one message, not two at
// odd times. "Розбір зараз" jumps the queue and is reset by [43] once it has been sent.
const isReviewDay = now.weekday === (DAYS[config.weeklyReviewDay] ?? 7);
const runReview = config.reviewNow || (config.weeklyReview && isReviewDay && runBrief);

return [{
  json: {
    run_brief: runBrief,
    run_review: runReview,
    forced,
    reason: forced ? 'run now' : runBrief ? 'brief hour' : alreadyToday ? 'already ran today' : `waiting for ${config.briefTime}`,
    config,
    started_at: now.toISO(),
  },
}];
