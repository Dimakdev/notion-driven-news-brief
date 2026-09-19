# Setup

Every key, what it is for, and what goes wrong without it. The short version is in the README; this is
the one to open when something does not work.

## Keys

| Variable | Where it comes from | Without it |
|---|---|---|
| `N8N_API_KEY` | n8n → Settings → n8n API → Create an API key | `deploy.py` cannot import anything |
| `N8N_BASE_URL` | `http://localhost:5678` unless you moved it | same |
| `PUBLIC_BASE_URL` | the address n8n answers on from outside | only used by scripts; the workflow reads `Адреса n8n` from Notion |
| `NOTION_TOKEN` | <https://www.notion.so/my-integrations> → internal integration | every Notion call fails |
| `NOTION_PARENT_PAGE_ID` | the page the databases are created under | only needed for `--create-databases` |
| `NOTION_DB_*` | printed by `deploy.py --create-databases` | the workflow has nowhere to read or write |
| `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> | no scoring, no write-ups |
| `ANTHROPIC_API_KEY` | <https://console.anthropic.com/settings/keys> | only for `--provider anthropic` |
| `TELEGRAM_BOT_TOKEN` | @BotFather | nothing is delivered |
| `TELEGRAM_CHAT_ID` | `python scripts/telegram_chat_id.py` | the brief has no addressee |

`.env` is in `.gitignore`, and so is `.deploy-state.json`, which holds the ids of the credentials and
workflows that `deploy.py` created. Neither is ever written into `workflow.json`: the graph carries
`__PLACEHOLDER__` strings that are substituted at deploy time.

## The Notion integration

Three capabilities are needed: **Read content**, **Update content**, **Insert content**. Comment and
user capabilities are not used — leave them off.

Then **connect the integration to the page**. Open the page the databases live under, `···` →
Connections → pick your integration, and confirm. Access is inherited by everything nested inside it.

> This is the step that costs people an hour. Without it the token is perfectly valid and every query
> answers `404 object_not_found`, which looks exactly like a wrong database id.

### Two different ids

A Notion database has a **database id** — 32 hex characters, visible in the page URL — and an internal
**data-source id**, which some tools show as `collection://<uuid>`. The REST API this workflow uses
(`/v1/databases/<id>/query`, version `2022-06-28`) accepts only the first. The second returns
`404 object_not_found` and is indistinguishable from a permissions problem.

## Deploy

```bash
python scripts/deploy.py --create-databases     # first time
python scripts/deploy.py                        # after that
```

What it does, in order: creates the six databases in two passes (properties first, then relations,
because a relation needs an id that does not exist on the first pass); creates the n8n credentials;
substitutes the placeholders; imports the error workflow first so the main one can point at it;
activates both.

It never writes `.env`. After `--create-databases` it prints the `NOTION_DB_*` lines to paste in.

It also carries the existing static data across an update. Without that, every redeploy would empty
the seen-index and the next brief would repeat a week of articles.

Useful flags: `--no-activate` to import without switching anything on, `--provider anthropic` to wire
Claude instead of Gemini (rebuild first with the same flag).

## Importing by hand

If you would rather not run the script: import `error-workflow.json`, then `workflow.json`, from the
n8n UI. Then find and replace each `__PLACEHOLDER__` in the imported nodes — the database ids, the
Telegram chat id, the error workflow id — and attach the credentials to the nodes that want them. The
build script prints the full list of placeholders.

## Connecting your own source

1. A row in `Джерела`: name, address, type, `Статус = Активне`, and at least one topic in `Теми`.
2. If the type is new, one entry in `SOURCES` in `src/nodes/build_fetch_plan.js` and one option in the
   `Тип` column, then `python scripts/build_workflow.py && python scripts/deploy.py`.

A source linked to no topic is never fetched — this is deliberate, not a bug.

## Connecting a different messenger

`DELIVERY` in the same file. Telegram is the reference implementation. WhatsApp needs a Meta Business
account and an approved template, and the button limits are strict — `LIMITATIONS.md` has the details
and they are worth reading before promising anyone a date.

## When something does not work

| Symptom | Cause |
|---|---|
| Every Notion call 404s | integration not connected to the page, or a data-source id instead of a database id |
| `The requested webhook is not registered` | the workflow is not active, or the path is in `options.path` instead of `parameters.path` |
| Activation fails with `Bad request` | a trigger cannot register — most often the Telegram Trigger against a private address. Disable it and activate again |
| Brief arrives, "Читати оригінал" is plain text | `Адреса n8n` is not public; Telegram will not linkify a private address. This is handled — links point straight at the article instead |
| The same articles arrive every day | the seen-index is not being written. Check `staticData` on the workflow; a redeploy that dropped it is the usual cause |
| A topic produces nothing | no live sources, an empty `Критерій`, or a threshold nothing reaches. `python scripts/run_tests.py --case config` names all three |
| Brief is empty but sources are fine | look at the score distribution in `Стрічка`. If everything clusters just below the bar, the threshold is too high for that topic |

## Checking it

```bash
python scripts/run_tests.py            # all five cases
python scripts/run_tests.py --case feeds
```

Two endpoints exist for trying things without waiting for a schedule:

```bash
curl -X POST http://localhost:5678/webhook/run-now
curl -X POST http://localhost:5678/webhook/find-sources
```

`config` parses the control panel, `feeds` fetches every live source for real, `brief` runs the whole
chain and prints the funnel, `memory` checks the seen-index is growing, `webhook` resolves a real hash
and a bogus one.
