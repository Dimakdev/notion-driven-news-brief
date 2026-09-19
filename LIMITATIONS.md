# What this does not do

Written before anyone asks, because software that only lists its strengths is an advertisement.

## By design

**One person.** There is no notion of users. Two people wanting two briefs means two deployments. Adding
multi-tenancy is not a flag, it touches the seen-index, the settings table and the delivery layer.

**No paywalls.** Feeds behind a paywall give a headline and a two-line excerpt, and that is all the
model sees. The judgement is honest about that; the article may still be worth more or less than it
looked.

**No embeddings.** Duplicate detection compares title word-sets, and the cheap filter compares keywords.
Two reports of the same event written with completely different headlines will both arrive. The stored
score and the `Duplicates` count make this visible, but nothing corrects it automatically.

**Thirty days of memory.** The seen-index is a rolling window. An article that resurfaces in March after
being sent in January is sent again. The window is a setting; making it a year would work and would also
mean a slowly growing blob in n8n's static data.

**No ranking beyond the score.** Items are grouped by topic and sorted by score. There is no
personalisation model, no decay, no learning weights, the only thing that changes behaviour over time
is you editing the table, which is the point.

## Operational

**Link tracking needs a reachable n8n.** On `localhost` the links in the brief open only on that machine.
Telegram's buttons have the same requirement. Without a public address you keep the brief and the weekly
review and lose the click signal.

**Notion's write rate is about three calls a second.** This is why only what shipped is archived and the
rest is kept as counters. A version that logged every article it looked at would spend a minute a day
writing rows nobody reads and would make the table unusable within a quarter.

**A source behind a real anti-bot wall stays unreachable.** Cloudflare-protected publishers answer the
workflow with a challenge page. It parses as zero entries, the source degrades, and it says so. That is
the correct outcome and it is not a bug to fix with a better user agent.

**The model sometimes returns nothing usable.** A chunk that comes back unreadable is counted in
`Runs` under `Errors` and its articles are not marked as seen, so they get another chance the next
morning. They do not appear in that day's brief.

**Costs scale with sources, not with topics.** Adding a topic adds a few lines to one prompt. Adding six
noisy sources adds a few hundred articles a day to score. The budget ceiling protects the bill, and says
out loud in the footer when it bites.

## WhatsApp, specifically

Telegram is the reference channel because it has none of the following. Checked against Meta's own
documentation (*Template components*, updated 24 Jun 2026):

- A template message is the **only** kind that may be sent outside a 24-hour customer-service window, so
  a daily brief must be a template, which must be approved before first use.
- Templates can carry buttons: up to ten `QUICK_REPLY`, label max 25 characters.
- **More than three buttons and only two are shown**, the rest hide behind "See all options".
- **Four or more buttons, or a quick reply mixed with any other button type, will not open on WhatsApp
  desktop at all** — the recipient is told to look at their phone.
- Mixing types must be grouped: `QR, QR, URL` is accepted, `QR, URL, QR` is rejected by the API.

So on WhatsApp the daily message is a short template with one URL button to the archive page, and the
weekly review is a separate message with two quick replies. Workable, but it is a day of work and an
approval queue, not a config change.

## Found by running it

**Reddit blocks unauthenticated reads.** The `reddit` adapter is written and works against the JSON
endpoints, but Reddit now answers most hosts with an HTTP error unless the request is authenticated.
Using it for real means adding your own Reddit credentials. Checked 18 Sep 2026 against
`r/LocalLLaMA` and `r/MachineLearning` — both refused.

**Archive feeds are downloaded whole, every run.** Some publishers serve their entire history in one
file: OpenAI's news feed carries 1209 entries, Hugging Face's blog 862. The time window discards
almost all of it, but the bytes still cross the wire daily. It works and it is wasteful; conditional
requests (`If-Modified-Since`) would fix it and are not implemented.

**A model occasionally answers off-schema.** Both model calls retry once and then continue without
that chunk rather than ending the run. Articles from a failed chunk are counted as `no_verdict` in the
run row and are not marked as seen, so they get another chance the next morning, but they are missing
from that day's brief.

**Telegram will not link a private address.** If `n8n address` is not public, the workflow drops the
click wrapper and links straight to the article. That is the right behaviour, but it means click data
simply does not exist for a local install, and the weekly review is the only feedback left.

**A Telegram Trigger cannot be activated against localhost.** Telegram refuses to register a webhook
on a private address, and n8n rolls back the activation of the *entire workflow* when one trigger
fails. The node ships disabled; enable it once n8n has a public URL.

## Known rough edges

- `Brief time` is read hourly, so moving the brief takes effect the same day but not the same minute.
- A topic whose `Criterion` is empty is skipped and named in the run row, rather than scoring everything
  against an empty string.
- The weekly review shows at most 25 items in one message; a busier week links to the archive for the
  rest.
- Source discovery proposes, it does not survey. It will not find every good feed in a niche, and it
  leans towards well-known publications.
