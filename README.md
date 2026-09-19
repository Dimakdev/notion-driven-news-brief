# Notion-driven news brief

I get a short digest every morning of things I actually want to read. What it looks for, where it
reads, and how picky it is all live in six Notion tables. An n8n workflow does the rest.

I have been running some version of this since April 2026. The first one kept everything in a single
prompt: the topics, the sources, the rules. It worked, but changing my mind meant editing an
instruction file, and I was not going to hand that to anyone. So I moved all of it into a database.
Now changing my mind is editing a row.

```
                    +------------ Notion ------------+
   every hour ------>  Settings   Topics   Sources    |
                    +---------------+----------------+
                                    v
   fetch the sources --> stage 1: window, already seen, duplicates, muted, keywords
                                    v
                        stage 2: a model scores each one against your criterion
                                    v
                        write it up --> Telegram --> archive --> remember --> log the run
```

## How a morning goes

The workflow wakes up every hour, reads the Settings table, and goes back to sleep unless it is the
hour you asked for. The time of day is a row, not a cron expression buried in a node.

When it is the right hour it reads your topics and their sources, and fetches each one. RSS, Atom, a
YouTube channel, a subreddit, Hacker News, any JSON endpoint.

Then two stages. The first is plain code and costs nothing: it drops anything outside your time
window, anything already sent, the same story arriving from three places, anything with a muted word
in it, and anything matching none of your keywords. On my setup that is usually a couple of thousand
items down to about ten.

The second stage costs money, so it only sees what survived. A model scores each one from 0 to 100
against the criterion you wrote in your own words, and says in a few words what matched.

Everything above your threshold gets written up and sent. All of it. If fifteen articles clear the
bar you get fifteen. If one does, you get one. If none do it says so and stops. There is no cap in
the code anywhere, and nothing gets padded to look busy.

After that it archives what it sent, writes eight numbers about the run, and only then updates its
memory of what has been seen.

You read the thing in Telegram. Tapping a link records the click and takes you to the article. That
click is the whole feedback loop. Nothing to press before you have read anything.

Once a week you get a short review: how many arrived, how many you opened, which ones you did not.
You can turn it off with one field.

## Why a database instead of a prompt

A prompt full of your interests is something only you can safely edit. A table is something you can
hand to someone else.

| Table | What it answers | What you edit |
|---|---|---|
| `Topics` | what to look for | the criterion, keywords, muted words, the threshold |
| `Sources` | where to read | addresses, types, and a checkbox that starts source discovery |
| `Feed` | what got sent | usually nothing. It is the archive and the click record |
| `Runs` | how the filter did | nothing. Eight numbers a day |
| `Settings` | time, language, channel, ceilings, holiday | all of it |
| `Briefs` | one page per morning | nothing. It is what the "full brief" link opens |

Two fields do most of the work.

**Criterion** is the text the model scores against. Write it the way you would explain the topic to a
friend, and include what you do *not* want. The negative half matters more than you would think.

**Threshold** is the volume knob for that topic. Too noisy, raise it. Feels like it is missing things,
lower it. Every score is stored in `Feed`, so after a week you can look at the spread and set it on
evidence instead of guessing.

Leaving `Signals` empty is not an oversight. It turns the keyword filter off for that topic and sends
everything in the window to the model. Costs more, misses nothing.

## Finding sources

Tick `Find sources` on a topic and wait a few minutes.

A model suggests feeds. Then the code fetches every single one and checks it: does it parse, does it
have more than a couple of entries, did it publish anything in the last two weeks, is it already in
your list. Whatever survives shows up in `Sources` marked `Proposed`, with the numbers filled in. You
switch on the ones you want.

The fetching step is there because models make up feed addresses that look completely reasonable and
return 404. It also tells you things the model cannot: when I ran this for a topic about smart
glasses, five candidates passed, and the numbers showed 9to5Mac publishes about 207 items a week
while Apple Developer News publishes one. Both are fine sources. They are not the same kind of thing,
and you only find that out by fetching them.

## What is in here

| Path | What it is |
|---|---|
| `workflow.json` | the workflow, 79 nodes, ready to import, no secrets in it |
| `error-workflow.json` | the error handler. One alert per crash with the node and execution id |
| `src/nodes/` | 28 JavaScript files, one per Code node. This is the part worth reading |
| `schema/notion.json` | the six databases as data, so they can be rebuilt anywhere |
| `scripts/deploy.py` | makes the databases and credentials, imports and activates both workflows |
| `scripts/seed_notion.py` | three example topics and two sources, enough to see it work |
| `scripts/build_workflow.py` | rebuilds the JSON from `src/nodes/` after you edit a node |
| `scripts/run_tests.py` | five checks against your real Notion and n8n |
| `scripts/telegram_chat_id.py` | prints your chat id after you message the bot once |
| `docs/` | architecture, setup, and the design notes I wrote before building it |
| `LIMITATIONS.md` | what it does not do |
| `docker-compose.yml` | a minimal n8n if you do not have one |

## Setting it up

```bash
git clone <your fork> && cd notion-driven-news-brief
cp .env.example .env
docker compose up -d
```

n8n comes up on <http://localhost:5678>. First visit creates the account. Then Settings, n8n API,
create a key, and put it in `N8N_API_KEY`.

For Notion, make an internal integration at <https://www.notion.so/my-integrations> with read, update
and insert permissions, and put the token in `NOTION_TOKEN`. Then open the page you want the databases
to live under, connect the integration to it from the `...` menu, and copy that page id into
`NOTION_PARENT_PAGE_ID`.

Do not skip connecting the integration to the page. If you do, the token is perfectly valid and every
single query comes back `404 object_not_found`, which looks exactly like you typed the wrong id. I
lost an hour to that.

Add a Gemini key from <https://aistudio.google.com/apikey> and a bot token from @BotFather, then:

```bash
python scripts/deploy.py --create-databases
python scripts/seed_notion.py
```

`deploy.py` prints the `NOTION_DB_*` lines for you to paste into `.env`. It does not write that file
itself on purpose. A script that edits the file holding all your keys is a script you should have to
read carefully first.

Message your bot once, run `python scripts/telegram_chat_id.py` for the chat id, put that in `.env`
too, and run `deploy.py` again.

### Trying it without waiting until tomorrow

```bash
curl -X POST http://localhost:5678/webhook/run-now
curl -X POST http://localhost:5678/webhook/find-sources
```

Both of these started life as test hooks and stayed, because "give me the brief now" turns out to be
something I want.

### Checking it works

```bash
python scripts/run_tests.py
```

It reads your control panel, fetches every live source for real, runs the whole chain and prints the
funnel, checks the memory is actually filling up, and makes sure the link redirector sends a real hash
to its article and a made-up one somewhere harmless.

### About the links

Links in the brief go through your own n8n so the click can be counted. On plain localhost that cannot
work, and Telegram will not even turn a localhost address into a link, so you get the words with
nothing behind them.

The workflow checks for this instead of pretending. If the `n8n address` setting is not public, links
point straight at the article and the run log notes that tracking is off. Put n8n somewhere reachable,
change that one row, and the wrapper comes back on. No redeploy.

Telegram's buttons need the same thing. n8n cannot even activate a Telegram Trigger against localhost
because Telegram refuses to register the webhook, so that node ships disabled and everything else
works without it.

## Changing things

A new kind of source is one entry in `SOURCES` in `src/nodes/build_fetch_plan.js` plus one option in
the `Type` column. Nothing else in the graph changes.

A different messenger is one entry in `DELIVERY` in the same file. Telegram is the one that is built.
What WhatsApp needs is in `LIMITATIONS.md` and it is worse than it sounds.

A different model: `python scripts/build_workflow.py --provider anthropic`, then redeploy.

The digest's language is a Settings row. `en` by default, and the model gets told the language by
name. Everything else about the system stays in English.

Thresholds, windows, muted words, the time of day, going on holiday: none of that is in the code.

## Things that broke while I was building this

All of these came from running it, not from reading it. Most of them would have been quiet in
production rather than loud, which is the annoying kind.

| What happened | Why |
|---|---|
| Every Notion query came back 404 | a database has two ids, and the REST API only takes one of them. Looks exactly like a permissions problem |
| The webhook was never registered | a Webhook node's path goes in `parameters.path`, not `options.path` |
| A node read a table that had not been fetched yet | two branches into one node does not make n8n wait for both |
| No topics found, no error either | a Notion query answers with one object containing `results`, not N items |
| Source metadata kept vanishing | HTTP Request, the XML node and the Telegram node all replace the item they are given. Three bugs, one cause |
| One dead feed killed the whole morning | a publisher dropped its RSS and started serving an HTML page at the same address. No 404, nothing |
| Every verdict came back empty | the model would not copy 32-character hex ids. It gets `t1`, `t2` now and they get mapped back in code |
| The memory never filled up | `Commit seen` read its own input, and the Telegram node before it had already replaced it. This is the bad one: the brief would have looked completely fine and repeated the same articles every day |
| Redeploying wiped that memory | a freshly built `workflow.json` has no `staticData` |
| One malformed model answer ended the run | no retry. Both model calls retry once now and carry on without that chunk |
| "Read the original" was not a link | Telegram will not linkify localhost |
| An n8n advert under every brief | the Telegram node appends its own footer unless you tell it not to |
| Renaming a Notion select option emptied it everywhere | you have to keep the option's id. Strip it and Notion makes new options and silently clears every page using the old ones |

## Worth knowing before you try it

It is built for one person. There is no multi-tenancy and adding it is not a small job.

It does not get past paywalls. Those sources get judged on a headline and two lines of excerpt.

Similarity is keywords and titles, not embeddings, so two write-ups of the same event with very
different headlines will both come through.

The memory holds thirty days.

Reddit blocks unauthenticated JSON from most hosts now, so that adapter needs your own credentials to
be much use.

The rest is in [LIMITATIONS.md](LIMITATIONS.md).

MIT licensed. Fork it, point it at your own Notion, and tell it what you actually want to read.
