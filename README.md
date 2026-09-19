# Notion-driven news brief

A morning digest that reads what *you* said you care about, not what a prompt was written to care
about. Six tables in Notion decide everything: what to look for, where to read it, how strict to be,
and what has already been sent. An n8n workflow does the rest — fetching, de-duplicating, scoring,
delivering, and keeping an honest record of what it threw away.

It is the rebuilt version of a routine that has run every morning since April 2026. The original kept
its topics, its sources and its rules as prose inside one prompt, which meant changing your mind meant
editing an instruction file. Here, changing your mind is editing a row.

```
                    ┌──────────── Notion ────────────┐
   every hour ──────▶  Налаштування  Теми  Джерела   │
                    └───────────────┬────────────────┘
                                    ▼
   fetch 11 sources ──▶ stage 1: window · already seen · duplicates · muted · keywords
                                    ▼  (≈2300 → ≈10)
                        stage 2: a model scores each one against YOUR criterion
                                    ▼  (everything above your threshold — no cap)
                        write it up ──▶ Telegram ──▶ archive ──▶ remember ──▶ run row
```

## What a morning looks like

1. The workflow wakes up, reads `Налаштування`, and stops again unless this is the hour you asked
   for. The time of day is data, not a cron expression buried in a node.
2. It reads your active topics and their live sources, and fetches each source through its adapter —
   RSS, Atom, a YouTube channel, a subreddit, Hacker News, or any JSON endpoint.
3. **Stage one, free.** Everything outside your time window, everything already sent, the same story
   arriving from three sources, anything carrying a muted word, and anything matching none of your
   keywords is dropped. On a real morning here: 2281 fetched, 10 survive.
4. **Stage two, paid.** A model scores each survivor from 0 to 100 against the *criterion you wrote in
   your own words*, and says in one phrase what matched.
5. Everything above that topic's threshold is written up and sent. **Everything.** Fifteen articles
   above the bar is a fifteen-item brief. One is one. None says "сьогодні нічого" and stops. There is
   no cap anywhere in the code and nothing is padded to look busy.
6. What shipped is archived, the run is recorded as eight numbers, and only then — after the brief has
   actually been delivered — is the seen-index updated.

You read it in the messenger. Tapping a link records the click and sends you to the article. That
click is the feedback loop: nothing to press before you have read anything, no rating a headline you
have not opened.

Once a week — switchable off with one field — a short review arrives: how many arrived, how many you
opened, and which ones you did not. Judgement after reading, not before, and marked in the database
rather than by a button you have to find.

## Why a database instead of a prompt

A prompt that knows your interests is a prompt only you can edit, and only carefully. A table anyone
can edit turns the same system into something you hand to someone else.

| Table | Answers | You edit |
|---|---|---|
| `Теми` | what to look for | the criterion in plain language, keywords, muted words, the threshold |
| `Джерела` | where to read | addresses, types, and one checkbox that starts source discovery |
| `Стрічка` | what was sent | nothing, usually — it is the archive and the click record |
| `Прогони` | how the filter did | nothing — eight numbers a day, the basis of every metric |
| `Налаштування` | time, channel, ceilings, holiday | all of it |
| `Брифи` | one page per morning | nothing — it is what "повний бриф ↗" opens |

Two fields are worth understanding:

- **`Критерій`** is the text the model judges against. It replaces a paragraph of prompt. Write it the
  way you would explain the topic to a person, *including what you do not want* — the negative half
  does most of the work.
- **`Поріг`** is your volume knob, per topic. Noisy → raise it. Feels like it is missing things →
  lower it. Every item's score is stored in `Стрічка`, so after a week you set it on evidence rather
  than by feel.

Leaving `Сигнали` empty is deliberate, not incomplete: it switches the keyword filter off for that
topic and sends everything in the window to the model. More expensive, misses nothing.

## Source discovery: proposed, verified, approved

Tick `🔍 Знайти джерела` on a topic. Within a few minutes:

1. a model proposes candidate feeds;
2. **the code fetches every one of them** — does it parse, does it hold more than a couple of entries,
   was the last one published in the past fortnight, is it already in your list;
3. survivors land in `Джерела` as `Запропоновано`, with the measured numbers filled in;
4. you set the ones you want to `Активне`.

A real run, for a topic about smart glasses: five proposed, five verified, and the numbers told the
story the model could not — 9to5Mac publishes 207 items a week (a firehose), Apple Developer News
publishes one (a trickle). Both are live and useful; they are not the same kind of source, and only
fetching them shows that.

Models invent feeds that look plausible and return 404. Step 2 is why an invented address never
reaches the database. The model proposes, the code checks, the person decides.

## What is where

| Path | What it is |
|---|---|
| `workflow.json` | the workflow, 78 nodes, import-ready, no secrets inside |
| `error-workflow.json` | the error handler: one alert per crash, naming the node and the execution |
| `src/nodes/` | the twenty-eight Code nodes as plain JavaScript — the part worth reading |
| `schema/notion.json` | the six databases as data, so they can be rebuilt in any workspace |
| `scripts/deploy.py` | creates the databases and credentials, imports and activates both workflows |
| `scripts/seed_notion.py` | three example topics and two sources, enough to see it work |
| `scripts/build_workflow.py` | rebuilds the JSON from `src/nodes/` after you edit a node |
| `scripts/run_tests.py` | five integration cases against your real Notion and n8n |
| `scripts/telegram_chat_id.py` | prints your chat id after you message the bot once |
| `docs/` | architecture, setup, and the design document written before the build |
| `LIMITATIONS.md` | what this does not do |
| `docker-compose.yml` | a minimal n8n, if you do not have one running |

## Get it running

```bash
git clone <your fork> && cd notion-driven-news-brief
cp .env.example .env
docker compose up -d
```

n8n comes up at <http://localhost:5678>; the first visit creates the owner account. Then
**Settings → n8n API → create a key** → `N8N_API_KEY` in `.env`.

In Notion, create an internal integration at <https://www.notion.so/my-integrations> with **Read,
Update and Insert content**. Put its token in `NOTION_TOKEN`. Then open the page the databases should
live under, connect the integration to it (`···` → Connections), and copy that page's id into
`NOTION_PARENT_PAGE_ID`.

> Connecting the integration to the page is the step everyone skips. Without it the token is valid and
> every query answers `404 object_not_found`, which reads exactly like a wrong id.

Add a Gemini key from <https://aistudio.google.com/apikey>, a bot token from @BotFather, then:

```bash
python scripts/deploy.py --create-databases
```

It prints the `NOTION_DB_*` lines to paste into `.env` — it does not write that file itself, because a
script that edits the file holding your keys is a script you have to read very carefully. Then:

```bash
python scripts/seed_notion.py
```

Message your bot once and run `python scripts/telegram_chat_id.py` for `TELEGRAM_CHAT_ID`, put it in
`.env`, and run `deploy.py` again to wire it in.

### Try it without waiting

```bash
curl -X POST http://localhost:5678/webhook/run-now       # the brief, now
curl -X POST http://localhost:5678/webhook/find-sources  # source discovery, now
```

Same chains, schedule skipped. Both stayed in after testing, because "give me the brief now" and
"find me sources for this topic now" are reasonable things to want.

### Check that it works

```bash
python scripts/run_tests.py
```

Five cases against the real thing: the control panel parses, every live source answers and is still
publishing, a full run completes and the funnel is printed, the seen-index is actually growing, and the
link redirector resolves a real hash while sending a bogus one somewhere harmless.

### One thing about links

Every link in the brief goes through your own n8n so the click can be recorded. On plain `localhost`
that cannot work — and Telegram will not even render a `localhost` href as a link, so the reader gets
plain text and no way to open anything.

The workflow handles this rather than pretending: when `Адреса n8n` in `Налаштування` is not a public
address, links point straight at the article and the run row notes that tracking is off. Put n8n behind
a public URL, change that one row, and the wrapper switches itself on. No redeploy.

Telegram's callback buttons need the same public address — n8n cannot even activate a Telegram Trigger
against `localhost`, because Telegram refuses to register the webhook. Until then that node stays
disabled and the brief works without it.

## Make it yours

- **A new kind of source** — one entry in `SOURCES` in `src/nodes/build_fetch_plan.js`, one option in
  the `Тип` column. The rest of the graph does not change.
- **A different messenger** — one entry in `DELIVERY` in the same file. Telegram is the reference;
  what WhatsApp requires is in `LIMITATIONS.md`, and it is more than it looks.
- **A different model** — `python scripts/build_workflow.py --provider anthropic`, then redeploy.
- **Different thresholds, windows, muted words, the time of day, a holiday** — none of that is in the
  code. It is in Notion.

## What broke while building this

Every one of these was found by running it, not by reading it. They are the reason the graph looks the
way it does, and most of them would be quiet in production rather than loud.

| What happened | Why | What it cost |
|---|---|---|
| Every Notion query returned 404 | a database has two ids — the database id and the data-source id, and the REST API takes only the first | looks exactly like a permissions problem |
| Webhook never registered | a Webhook node's path is `parameters.path`, not `options.path` | — |
| A node read a table that had not been fetched | two branches into one node does **not** make n8n wait for both | — |
| No topics found, no error | a Notion query answers with **one** object holding `results`, not N items | reads as "nothing is active" |
| Source metadata vanished mid-flow | the XML node replaces the whole item with what it parsed; so does an HTTP node, and so does the Telegram node | three separate bugs, one cause |
| One dead feed killed the whole morning | a publisher dropped its RSS and started serving an HTML page at the same address — no 404 | everyone loses the brief because one site redesigned |
| Every verdict came back empty | the model would not copy 32-character hex ids; it now gets `t1`…`t6` and they are mapped back in code | the reasons described real matches while the topic was blank |
| The seen-index stayed empty | `Commit seen` read its input, and the Telegram node before it had replaced the item | **the worst one**: the brief would have looked fine and repeated the same articles daily |
| Redeploying wiped the memory | a freshly built `workflow.json` has no `staticData` | a week of articles would return after every deploy |
| One malformed model answer ended the run | no retry, no fallback | both model calls now retry once and degrade instead of crashing |
| "Читати оригінал" was not a link | Telegram refuses to linkify `localhost` | the digest arrived unreadable |
| An n8n advert under every brief | the Telegram node appends its own attribution unless told not to | — |

## Honest notes

- Built for one person. No multi-tenancy, and adding it is not a small change.
- It does not read past paywalls; those sources are judged on a headline and an excerpt.
- Similarity is keywords and titles, not embeddings.
- The seen-index holds thirty days.
- Reddit now blocks unauthenticated JSON requests from most hosts, so the `reddit` adapter needs your
  own credentials to be useful.
- The full list is in [LIMITATIONS.md](LIMITATIONS.md).

Built by Dmytro Kravchuk as a portfolio piece. MIT licensed — fork it, point it at your own Notion, and
tell it what you actually want to read.
