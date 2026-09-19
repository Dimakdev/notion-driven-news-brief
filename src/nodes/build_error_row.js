// [E1] Error workflow. n8n hands it whatever crashed; it turns that into one line a person can act on
// at 5 in the morning without opening the editor.
const e = $input.first().json;
const wf = e.workflow || {};
const err = e.execution?.error || e.error || {};
const node = err.node?.name || e.execution?.lastNodeExecuted || 'unknown node';
const when = DateTime.now().toFormat('dd.MM HH:mm');

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const message = String(err.message || err.description || 'no message').slice(0, 400);

// The execution id is the whole point of the alert: the message says what broke, the id is where the
// data that broke it is still sitting, replayable. The error workflow has no access to the control
// panel, so it prints the id rather than guessing this n8n's address.
const execId = e.execution?.id;

const alert = [
  `⚠️ <b>The brief crashed</b> · ${when}`,
  `Node: <code>${esc(node)}</code>`,
  esc(message),
  execId ? `Execution <code>${esc(execId)}</code> — open it in n8n, the data is kept` : null,
  // Said plainly so a failure does not look like a quiet day: nothing was marked as seen, so the same
  // articles are still waiting tomorrow.
  'The seen-index was not advanced — these articles will come round again tomorrow.',
].filter(Boolean).join('\n');

return [{ json: { alert, node, message, workflow_id: wf.id || null, execution_id: execId || null } }];
