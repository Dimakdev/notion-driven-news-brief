# Design document

Written before the build and translated here. The last section is what changed once it
met reality — kept separate on purpose, because a design document that was right about everything was
either trivial or rewritten afterwards.

## What the case proves

That a person controls their own information flow by editing a table rather than a prompt. Adding
"cooking" is a row. Removing what has become tiresome is a row. The system finds where to read it,
checks those sources for real, and arrives each morning with what actually fits.

And that the filter learns: what you open changes what you are shown.

What it does **not** claim: a news aggregator as a service, ML ranking, multi-tenancy, paywall access.

### Already proven in production

The predecessor, `JUN Brief`, has run every morning since 25 April 2026 without a gap. Five months of
unbroken runs, a real history of breakage, and real numbers on every one. This case moves its logic
out of the prompt and into a database — so the README can honestly say it is a rewritten working tool,
not a prototype.

## The central decision

**The prompt knows nothing. The database knows everything.**

In the predecessor, sources, topics, stop-words and rules all lived as prose in one prompt. Changing
anything meant editing an instruction file. Here six Notion tables are the control panel, and the
model makes two narrow judgements.

### Carried over verbatim

These rules survived five months and were not rewritten:

- **A quality bar, not a quota.** Could be 3 items, could be 15. Never pad to reach a number, never
  cut a strong story to stay under one.
- **The "why it matters" line only when it is honest.** A forced line is worse than no line: it teaches the
  reader to skip the section.
- **The `{N} read · {M} included` footer.** A built-in honesty metric: you can see what was
  discarded.
- **Dry tone, no AI-speak.**
- **Payload to a file, then curl** — never escape JSON inside a shell command.
- **A report at the end of every run**: sources read, considered, included, delivery status.

## Memory, on three levels

The naive version — writing everything considered into Notion — does not survive. Six sources at
~30 entries each is ~180 a day: 5400 rows a month, 65000 a year, and 180 API writes every morning
against a limit of roughly three a second. The table is unusable within a quarter.

So memory is split by **who looks at it**: the seen-index is machine state and lives in n8n; the
archive is what a person browses and holds only what was sent; the metrics are one row a day of
counters. Precision, dead keywords and source productivity are all computable from aggregates.

## Feedback without buttons at delivery

A button under an item asks for a verdict *before* the article has been read, and asks for it at the
worst possible moment — just as the reader is about to leave. It rates the summary, not the piece.

A single button under the whole brief is worse: if five items were noise and the sixth was excellent,
"miss" is a lie.

So: **nothing to press at delivery.** The click through the link wrapper is the primary signal, taken
at the moment interest is real and costing the reader nothing. Per-item judgement happens in a weekly
review, after the reading, and that review can be switched off with one field.

## Source discovery

Asking a model for feed addresses and fetching them directly is the fastest route to hallucinated
URLs. So discovery is split: the model **proposes**, deterministic code **fetches and verifies** every
candidate (does it parse, how many entries, how fresh, is it a duplicate), and the person **approves**.

This is also the most sellable pattern in the case: AI proposes → code verifies → human approves.

## What changed once it ran

The design was right about the shape and wrong about several details. Each of these came from a live
run, not from review.

**The brief page needed its own table.** The design had five tables; the digest had nowhere to live
with a stable address. `Briefs` is the sixth.

**The model calls split in two.** The design had one. Judging is cheap and happens to ~40 articles;
writing is dear and should happen only to the handful that earned it. One pass would have paid full
price for everything discarded.

**Topics are labelled `t1..tN`, not by id.** The first live run returned six verdicts, every one with
an empty topic and a `reason` that plainly described a match. The model would not copy a 32-character
hex string. Short labels mapped back in code removed the failure completely.

**The trigger is hourly, not a cron at 05:00.** A cron expression inside a node cannot be edited from
Notion, which would have made the time of day the one setting that was not data. The gate now reads
only the settings table each hour and opens when it should.

**`Respond to Webhook` is fine here.** The design forbade it, generalising a constraint from the
previous case that was specific to the Form Trigger. There is no Form Trigger in this workflow, and
the 302 redirect needs that node.

**Link wrapping degrades instead of insisting.** When the configured address is not public, links go
straight to the article. Telegram will not render a `localhost` href as a link at all, so insisting on
the wrapper meant a digest whose links could not be tapped.

**Several nodes replace the item they are given.** HTTP Request, the XML node and the Telegram node
all do it. Three bugs in this build had that single cause, and the worst was silent: `Commit seen` read
its own input — which by then was Telegram's API response — so the seen-index never filled. The brief
would have looked healthy and repeated the same articles every morning.

**One dead feed must not end the morning.** VentureBeat's AI feed had stopped being a feed and started
serving an HTML page at the same address: no 404, no redirect. The XML node's response to that is to
throw, which took the whole run down. A format check now runs before the parser and the source simply
degrades, visibly.

## Boundaries

In `LIMITATIONS.md`, and worth reading before promising anything: no multi-tenancy, no paywalls, no
embeddings, a thirty-day memory, Reddit needs credentials, and WhatsApp needs an approved template
with strict button limits.
