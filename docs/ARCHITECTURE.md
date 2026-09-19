# Architecture

One workflow, six entry points, one error handler. The README says what it does; this says how, and
why each piece is shaped the way it is.

## The principle

**The prompt knows nothing. The database knows everything.**

The model makes exactly two narrow judgements — *propose sources for a topic* and *score an article
against a topic's criterion*. Fetching, de-duplicating, health, delivery, memory and logging are the
engine's work. Nothing about the user's interests is compiled into the graph.

## Entry points

| Trigger | Path | When |
|---|---|---|
| Schedule | every hour, on the hour | opens the gate only at the configured hour |
| Webhook `POST /webhook/run-now` | on demand | same chain, gate bypassed |
| Webhook `GET /webhook/r?i=<hash>` | a link in the brief was tapped | records the click, redirects |
| Telegram Trigger | a button was pressed | source approvals; ships disabled, needs a public address |
| Schedule | every fifteen minutes | source discovery, when a topic asks or runs dry |
| Webhook `POST /webhook/find-sources` | on demand | the same discovery chain |

An hourly schedule instead of a cron at 05:00 is deliberate: the time of day is part of what the user
controls, and a cron expression inside a node is not editable from Notion. The gate reads only the
`Налаштування` table — one small query per hour — and the heavier tables are read only when it opens.
The gate also holds the once-a-day guard, so a restart or a clock change cannot produce two briefs.

## The daily chain

| # | Node | What it does |
|---|---|---|
| 1 | Every hour | schedule trigger |
| 2 | Notion: Settings | one query, the cheapest possible gate input |
| 3 | Gate | decides brief / review / nothing; honours `Пауза`; guards against a second run |
| 4 | Brief hour? | IF |
| 5 | Notion: Topics → Notion: Sources | **sequential, not parallel** — see *Races* below |
| 6 | Load config | three tables become one config object; defaults applied; broken topics named |
| 7 | Build fetch plan | adapter map turns sources into HTTP requests |
| 8 | Lane | switch: xml lane / json lane |
| 9 | Fetch feed | `neverError`, 20 s timeout, plain user agent |
| 10 | Check feed | is this XML at all? runs **before** the parser |
| 11 | Looks like a feed? | IF: parse it, or send it to the failure lane |
| 12 | Parse XML | n8n's XML node |
| 13 | Attach source | puts the source back on the item, **after** parsing |
| 14 | Feeds | merge, three inputs: parsed, json, rejected |
| 15 | Normalize items | RSS / Atom / Reddit → one canonical item |
| 16 | Stage 1 filter | five checks, counters, budget ceiling |
| 17 | Build judge input | chunks of 8, topics labelled `t1..tN` |
| 18 | Judge relevance | model: score + matched phrase. Retries once, degrades on failure |
| 19 | Parse judge | maps verdicts back, applies each topic's threshold |
| 20 | Build writer input | chunks of 5, **only what passed** |
| 21 | Write digest | model: Ukrainian title, two or three sentences, "why it matters" |
| 22 | Compose digest | grouping, ordering, footer, Telegram HTML and page Markdown |
| 23 | Build Notion rows | payloads for the brief page and the archive rows |
| 24 | Notion: brief page | created first, so items can link back to it |
| 25 | Split feed rows → Notion: feed row | one row per item that shipped |
| 26 | Send brief | Telegram, attribution off |
| 27 | Commit seen | **the index moves only now**, after delivery |
| 28 | Build run row → Notion: run row | the day's eight numbers |
| 29 | Source health → Notion: update source | statuses, counters, notes |

## Contracts

### Canonical item

Everything any adapter returns is reduced to this before anything else looks at it:

```json
{
  "source_id": "", "source_type": "rss", "topic_ids": [],
  "url": "", "url_hash": "", "title": "", "domain": "",
  "summary_raw": "", "published_at": ""
}
```

`url_hash` is FNV-1a over a canonicalised URL (lower-cased host, `www.` and tracking parameters
stripped, trailing slash removed). **This hash is the memory.** Change the algorithm and every article
ever sent becomes new again.

### Judge verdict

```json
{ "i": 0, "topic_id": "t2", "score": 78, "reason": "збіг із критерієм: семантичний кеш" }
```

Topics are labelled `t1..tN` in the prompt and mapped back in code. Real Notion ids are 32 hex
characters; a model asked to echo one will often return an empty string while its `reason` plainly
describes a match. That failure was observed on the first live run and is not theoretical.

## The two stages

**Stage one is code and costs nothing.** In order, cheapest first: time window → seen-index →
cross-source clustering → muted words → keywords. A real morning: 2281 fetched, 2224 out of window,
1 duplicate, 46 with no keyword match, 10 to the model.

The keyword step is the only one that can cause a false negative, so it has an escape hatch: a topic
with an **empty** `Сигнали` list skips it entirely and sends everything in the window to the model.

**Stage two is a model and costs money.** One call per chunk of eight articles, with every topic's
criterion inside it — not one call per article-and-topic pair, which would multiply the bill by the
number of topics and let the same article arrive twice under two headings.

**The threshold decides what ships; nothing decides how many.** There is no cap in the code. The only
limit is `Стеля бюджету`, which caps how many candidates reach the model — a guard on cost, not on
output — and when it bites the brief says so in its own footer.

## Memory, in three places

| What | Where | Why there |
|---|---|---|
| Seen-index (hashes + dates) | n8n workflow static data | machine state; the user never looks at it, and 180 rows a day would make a Notion table unusable in a quarter |
| Archive (what was sent) | Notion `Стрічка` | the user does look at this; ~6 rows a day |
| Metrics (aggregates) | Notion `Прогони` | one row a day carries every number the archive would otherwise have to be scanned for |

The index is **read** during filtering and **written** only after delivery succeeds. A run that dies
anywhere before that costs nothing: the same articles are new again tomorrow. `deploy.py` carries the
static data across an update for the same reason.

## Reliability

- **Fetches** retry with backoff and never throw; **writes** do not retry, so nothing is duplicated.
- **Model calls** retry once, then continue without that chunk. A missing write-up still ships the
  article under its original headline.
- **Source health** walks visible states: 3 consecutive failures → `Деградує`, 7 → `На пенсії`, and
  the brief's footer names anything that has gone quiet. Silent thinning is the worst failure mode
  this kind of system has, because it looks like a slow news week.
- **Error workflow** sends one alert naming the node, the message and the execution id, and states
  plainly that the index was not advanced.

## Races and replacements — two n8n facts worth knowing

**Two branches into one node does not make n8n wait for both.** The node fires on the first arrival.
`Load config` reads three tables through `$('...')`, so the table nodes are chained one after another
rather than fanned out. One extra round trip buys determinism.

**Several node types replace the item they are given.** HTTP Request replaces it with the response,
the XML node with what it parsed, the Telegram node with the API's answer. Anything that must survive
has to be re-read from the node that produced it — `$('Build fetch plan').item` in a per-item Code
node, or `$('Build Notion rows').first()` after the send. Three separate bugs in this build had this
one cause, and the worst of them was silent: the seen-index never filled, so the brief would have
repeated itself every morning while looking perfectly healthy.

## Discovery branch

| # | Node | What it does |
|---|---|---|
| 31 | Every 15 min / Find sources now | one cheap query per quarter hour |
| 32 | Notion: Topics → Sources | what is asking, and what it already reads |
| 33 | Build discovery input | a topic asks by checkbox, or by having no live sources left |
| 34 | Propose sources | model: name, feed address, type, one line of why |
| 35 | Parse proposals | shape-checks addresses; `http(s)` only |
| 36 | Probe candidate | **fetches every one**, as text, never throwing |
| 37 | Validate sources | parses? enough entries? published in the past fortnight? not a duplicate? |
| 38 | Build source rows → Notion: new source | survivors land as `Запропоновано`, with measured numbers |
| 39 | Split topics to clear → Notion: clear checkbox | untick the request, found or not — otherwise it repeats every fifteen minutes |
| 40 | Report discovery | what passed, with numbers, and what was rejected, with reasons |

The probe deliberately does not go through the XML node: one invented address throwing would take the
whole discovery run with it, which is the same failure a dead feed caused on the daily path.

## Weekly review branch

Rides the same gate as the brief, so it arrives with the morning rather than at an odd hour. It reads
the past week from `Стрічка`, reports how much was opened, lists what was not, and resets the
`Розбір зараз` flag afterwards so asking for it early is a one-shot.

It carries **no buttons**. The Telegram node fixes its keyboard at build time, so a list that varies
week to week cannot be a row of buttons without contortions — and a callback needs a public address,
which a local install does not have. Verdicts are set in `Стрічка` instead, which is where the rest of
the control panel already lives.

## Adapters

Two maps in `src/nodes/build_fetch_plan.js`. A new source type or a new messenger is one entry; the
graph does not change.

| Sources | Delivery |
|---|---|
| `rss`, `atom`, `youtube`, `reddit`, `hn`, `json`, `web_search` | `telegram` (reference), `whatsapp`, `email` |

The storage layer is an adapter in principle too: the code talks to Notion through a narrow set of
operations — read topics, read sources, read settings, write a row, change a status. Google Sheets,
Airtable or a YAML file would each be a contained piece of work. Only Notion is built.
