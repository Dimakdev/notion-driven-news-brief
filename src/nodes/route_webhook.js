// [20] The webhook does three jobs, told apart by what arrived. It is one entry point because n8n
// activates one webhook path per workflow, and because all three are the same shape of work: a tap
// arrives, a row changes, the person gets on with their day.
//
//   /webhook/r?i=<hash>   a link in the brief was opened  -> record the click, redirect to the article
//   callback  мимо:<hash> the weekly review marked an item as noise
//   callback  src:<id>    a proposed source was approved
//
// Nothing here trusts what arrived: a hash is looked up, never used to build a redirect, and the
// target address is read from the archive row. A crafted link cannot turn this into an open redirect.
const req = $input.first().json;
const query = req.query || {};
const body = req.body || {};

const callback = body.callback_query || null;
const data = String(callback?.data || '').trim();
const hash = String(query.i || query.hash || '').trim();

function out(kind, extra) {
  return [{ json: { kind, ...extra } }];
}

// ---------------------------------------------------------------- 1. a click on an article link
if (hash) {
  // Only the shape is validated here; [21] resolves it against Стрічка and takes the address from the
  // stored row. An unknown hash lands on the brief archive rather than anywhere a stranger chose.
  const clean = /^[0-9a-f]{8}$/.test(hash) ? hash : '';
  return out('click', { hash: clean, valid: !!clean });
}

// ---------------------------------------------------------------- 2 and 3. a button in Telegram
if (data) {
  const [verb, arg] = data.split(':');
  const chatId = callback?.message?.chat?.id;
  const callbackId = callback?.id;

  if (verb === 'мимо' || verb === 'miss') {
    return out('verdict', { hash: String(arg || '').trim(), verdict: 'мимо', chat_id: chatId, callback_id: callbackId, toast: 'Позначено як мимо' });
  }
  if (verb === 'save') {
    return out('verdict', { hash: String(arg || '').trim(), verdict: '📌 збережено', chat_id: chatId, callback_id: callbackId, toast: 'Збережено' });
  }
  if (verb === 'src') {
    return out('approve_source', { page_id: String(arg || '').trim(), chat_id: chatId, callback_id: callbackId, toast: 'Джерело увімкнено' });
  }
  return out('unknown', { data, callback_id: callbackId, toast: '' });
}

// Telegram retries a callback it thinks failed, so anything unrecognised still answers 200 and stops.
return out('ignored', {});
