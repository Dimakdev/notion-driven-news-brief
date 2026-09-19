#!/usr/bin/env python3
"""Check that a deployment actually works, against the real Notion and the real n8n.

    python scripts/run_tests.py                 # everything
    python scripts/run_tests.py --case feeds    # just one

Cases:
  config    the control panel is readable and makes sense
  feeds     every active source answers, parses, and is still alive
  brief     one full run through the workflow, with the funnel printed
  memory    the seen-index grew and repeats are being caught
  webhook   the link redirector resolves a real hash and refuses a bogus one

These are integration tests on purpose. The interesting failures in this workflow were never bad
arithmetic — they were a node replacing an item, a feed quietly turning into an HTML page, a model
declining to copy a 32-character id. None of that shows up in a unit test with a fixture.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import N8n, Notion, http, load_env, load_state, plain, require  # noqa: E402

UA = "Mozilla/5.0 (compatible; notion-driven-news-brief/1.0; +https://github.com/)"
OK, FAIL, WARN = "  ok  ", " FAIL ", " warn "
results = []


def check(name: str, passed: bool | None, detail: str = ""):
    mark = OK if passed is True else (WARN if passed is None else FAIL)
    results.append(passed)
    print(f"[{mark}] {name}" + (f"   {detail}" if detail else ""))


def db(env, state, key):
    return env.get(f"NOTION_DB_{key.upper()}") or (state.get("databases") or {}).get(key)


# ---------------------------------------------------------------- cases
def case_config(env, state, notion, n8n):
    print("\nconfig — the control panel")
    topics = notion.query(db(env, state, "topics"))
    active = [t for t in topics if plain(t, "Status") == "Active"]
    check("topics readable", len(topics) > 0, f"{len(topics)} rows, {len(active)} active")

    no_criterion = [plain(t, "Topic") for t in active if not (plain(t, "Criterion") or "").strip()]
    check("every active topic has a criterion", not no_criterion,
          "skipped: " + ", ".join(no_criterion) if no_criterion else "")

    open_filter = [plain(t, "Topic") for t in active if not plain(t, "Signals")]
    if open_filter:
        check("topics with the keyword filter off", None,
              ", ".join(open_filter) + " — everything in the window reaches the model, by design")

    sources = notion.query(db(env, state, "sources"))
    live = [s for s in sources if plain(s, "Status") in ("Active", "Degrading")]
    check("sources readable", len(live) > 0, f"{len(live)} live of {len(sources)}")

    linked = {tid for s in live for tid in (plain(s, "Topics") or [])}
    orphans = [plain(t, "Topic") for t in active if t["id"] not in linked]
    check("every active topic has a source", not orphans,
          "no sources: " + ", ".join(orphans) if orphans else "")

    settings = {plain(r, "Key"): plain(r, "Value") for r in notion.query(db(env, state, "settings"))}
    for key in ("Brief time", "Channel", "Budget ceiling", "Memory window", "Pause", "n8n address"):
        check(f"setting «{key}»", key in settings, settings.get(key, "MISSING"))
    if str(settings.get("Pause", "")).strip().lower() in ("on", "yes", "on", "true"):
        check("Pause is on", None, "no brief will be sent until it is off")


def case_feeds(env, state, notion, n8n):
    print("\nfeeds — every live source, fetched for real")
    now = datetime.now(timezone.utc)
    for s in notion.query(db(env, state, "sources")):
        if plain(s, "Status") not in ("Active", "Degrading"):
            continue
        name, url, kind = plain(s, "Source"), plain(s, "Address"), plain(s, "Type")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=20) as r:
                txt = r.read().decode("utf-8", "replace")
        except Exception as ex:
            check(name, False, f"no answer: {type(ex).__name__}")
            continue
        head = txt[:300].lstrip()
        if kind != "reddit" and not re.match(r"<\?xml|<rss|<feed|<rdf", head, re.I):
            why = "serves an HTML page" if re.search(r"<!doctype html|<html", head, re.I) else "unknown format"
            check(name, False, f"not a feed: {why}")
            continue
        n = (len(re.findall(r"<item[ >]|<entry[ >]", txt)) if kind != "reddit"
             else len(json.loads(txt)["data"]["children"]))
        dates = []
        for raw in re.findall(r"<(?:pubDate|published|updated)>([^<]+)<", txt):
            for parse in (parsedate_to_datetime, lambda v: datetime.fromisoformat(v.replace("Z", "+00:00"))):
                try:
                    d = parse(raw.strip())
                    dates.append(d if d.tzinfo else d.replace(tzinfo=timezone.utc))
                    break
                except Exception:
                    continue
        stale = (now - max(dates)).days if dates else None
        if n < 3:
            check(name, False, f"only {n} entries")
        elif stale is not None and stale > 14:
            check(name, False, f"silent for {stale} days")
        else:
            check(name, True, f"{n} entries, last {max(dates).date() if dates else 'undated'}")


def case_brief(env, state, notion, n8n):
    print("\nbrief — one full run")
    base = env.get("N8N_BASE_URL", "http://localhost:5678").rstrip("/")
    try:
        http("POST", f"{base}/webhook/run-now", body={})
    except Exception:
        pass  # the webhook answers oddly when the last node returns nothing; the run still happened
    ex = n8n.executions((state.get("workflows") or {}).get("main"), limit=1, include_data=True)
    if not ex:
        check("run started", False, "no execution recorded")
        return
    rd = ex[0].get("data", {}).get("resultData", {})
    check("run finished without error", ex[0].get("status") == "success",
          str((rd.get("error") or {}).get("message", ""))[:120])

    runs = rd.get("runData", {})
    def first(node, key=None):
        d = (runs.get(node) or [{}])[0].get("data", {}).get("main", [[]])
        j = d[0][0]["json"] if d and d[0] else {}
        return j.get(key) if key else j

    st = first("Stage 1 filter")
    c = st.get("_counters") or st.get("counters") or {}
    if c:
        print(f"         funnel: {c.get('fetched')} fetched → {c.get('to_model')} to the model")
        print(f"         dropped: {c.get('dropped_out_of_window')} out of window, "
              f"{c.get('dropped_already_seen')} already seen, {c.get('dropped_duplicate')} duplicates, "
              f"{c.get('dropped_minus_signal')} muted, {c.get('dropped_no_signal')} no signal")
    check("stage 1 ran", bool(c), "")

    d = first("Compose digest")
    items = d.get("items") or []
    check("digest built", "telegram_text" in d, f"{len(items)} item(s)")
    if not items:
        # The wording follows the reader's language setting, so the flag is what is checked, not words.
        check("empty brief is honest", d.get("nothing_today") is True,
              "says so rather than sending a blank message")
    # Both shapes are usable. Tracking off is a deliberate degradation on a private address, not a
    # failure - it is flagged so it is noticed, not so it fails a build.
    check("links are usable", True if d.get("tracking_enabled") else None,
          "wrapped, clicks are counted" if d.get("tracking_enabled")
          else "the n8n address is not public: links go straight to the article, no click counter")
    check("brief delivered", "Send brief" in runs, "")
    check("archive written", "Notion: brief page" in runs, "")
    check("run row written", "Notion: run row" in runs, "")


def case_memory(env, state, notion, n8n):
    print("\nmemory — the seen-index")
    wf = n8n.get_workflow((state.get("workflows") or {}).get("main"))
    g = ((wf.get("staticData") or {}).get("global") or {})
    seen = g.get("seen") or {}
    check("index is being written", len(seen) > 0,
          f"{len(seen)} hashes" if seen else "nothing recorded — the brief would repeat itself daily")
    last = g.get("last_run") or {}
    check("last run recorded", bool(last), json.dumps(last, ensure_ascii=False))
    feed = notion.query(db(env, state, "feed"))
    check("archive matches", len(feed) >= len(seen),
          f"{len(feed)} rows in Feed vs {len(seen)} hashes remembered")


def case_webhook(env, state, notion, n8n):
    print("\nwebhook — the link redirector")
    base = env.get("N8N_BASE_URL", "http://localhost:5678").rstrip("/")
    rows = notion.query(db(env, state, "feed"))
    known = next((plain(r, "Hash") for r in rows if plain(r, "Hash")), None)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    opener = urllib.request.build_opener(NoRedirect)

    def probe(h):
        try:
            with opener.open(f"{base}/webhook/r?i={h}", timeout=20) as r:
                return r.status, r.headers.get("Location")
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Location")
        except Exception as e:
            return None, str(e)

    if known:
        code, loc = probe(known)
        check("a real hash redirects to its article", code == 302 and bool(loc), f"{code} → {str(loc)[:60]}")
    else:
        check("a real hash redirects", None, "nothing in Feed yet — send a brief first")

    code, loc = probe("deadbeef")
    check("an unknown hash lands somewhere harmless", code == 302 and "notion.so" in str(loc), f"{code} → {str(loc)[:40]}")


CASES = {"config": case_config, "feeds": case_feeds, "brief": case_brief,
         "memory": case_memory, "webhook": case_webhook}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", choices=[*CASES, "all"], default="all")
    args = ap.parse_args()

    env, state = load_env(), load_state()
    require(env, "N8N_API_KEY", "N8N_BASE_URL", "NOTION_TOKEN")
    notion, n8n = Notion(env["NOTION_TOKEN"]), N8n(env["N8N_BASE_URL"], env["N8N_API_KEY"])

    for name, fn in CASES.items():
        if args.case in (name, "all"):
            fn(env, state, notion, n8n)

    failed = results.count(False)
    warned = results.count(None)
    print(f"\n{'-' * 60}\n{results.count(True)} passed, {failed} failed, {warned} to look at")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
