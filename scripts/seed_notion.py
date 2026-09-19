#!/usr/bin/env python3
"""Fill a fresh control panel with enough to see the thing work.

    python scripts/seed_notion.py

Three topics, two sources, ten settings. Idempotent: rows that already exist by name are left alone,
so running it twice is safe.

Why only the first topic gets sources: the other two are deliberately left empty so that the first
thing a new install does is tick "Find sources" and watch discovery run - propose, verify by actually
fetching, approve. That flow is the point of the system and it is better seen than described.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import (Notion, load_env, load_state, multi, number, plain, relation, require,  # noqa: E402
                    rich, select, title)

TOPICS = [
    {
        "name": "AI and automation",
        "criterion": ("Agents, orchestration, automation tooling, model releases, and anything that "
                      "changes the cost or the shape of the work. I want specifics: what actually "
                      "changed and what to do about it. Not interested in predictions about the "
                      "future with no detail, or in corporate news."),
        "signals": ["ai agents", "agent", "llm", "automation", "n8n", "workflow", "open source",
                    "anthropic", "openai", "gemini", "model release", "rag", "mcp"],
        "muted": ["crypto", "nft", "funding round", "series a", "gadget review"],
        "languages": ["en"],
        "priority": "🔥 High",
        "threshold": 60,
    },
    {
        "name": "Cooking",
        "criterion": ("Techniques, recipes, explanations of why something works in a kitchen, and "
                      "reviews of equipment that is genuinely worth the money. Not interested in "
                      "restaurant news, weight-loss diets, or listicles with no reasoning."),
        # Deliberately empty: this is what "no keyword filter, let the model decide" looks like.
        "signals": [],
        "muted": ["diet", "weight loss", "restaurant opening"],
        "languages": ["en"],
        "priority": "⚡ Medium",
        "threshold": 65,
    },
    {
        "name": "Space",
        "criterion": ("Launches, missions, telescopes, findings. I want what actually happened, with "
                      "data. Not interested in rumours about extraterrestrial life, or in press "
                      "releases repeated without checking."),
        "signals": ["launch", "nasa", "spacex", "telescope", "mission", "orbit", "astronomy", "rover"],
        "muted": ["ufo", "alien", "conspiracy"],
        "languages": ["en"],
        "priority": "💤 Low",
        "threshold": 70,
    },
]

SOURCES = [
    {"name": "Hacker News", "url": "https://news.ycombinator.com/rss", "type": "hn",
     "topic": "AI and automation",
     "note": ("Titles are written by whoever submitted the link, not by the article's author, so the "
              "keyword filter is weaker here. The adapter keeps the linked article's domain.")},
    {"name": "TechCrunch AI", "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
     "type": "rss", "topic": "AI and automation",
     "note": "A topic feed, the cleanest of the starting set."},
]

SETTINGS = [
    ("Brief time", "05:00", "When the brief arrives, in the container's local time"),
    ("Brief language", "en",
     "The language the digest is written in: en, uk, de, fr, es, pl. Everything else stays English"),
    ("Channel", "telegram", "telegram / whatsapp / email"),
    ("Weekly review", "on",
     "on / off. Once a week, a list of what you did not open. The only place anything asks for a tap"),
    ("Review day", "sunday", "Which day the weekly review arrives"),
    ("Review now", "no", "Set to yes and the review goes out on the next run, then resets itself"),
    ("Budget ceiling", "250",
     "Most candidates handed to the model per run. A guard on the bill, not on how many items ship"),
    ("Memory window", "30", "How many days a sent article stays remembered. Older may arrive again"),
    ("Pause", "off", "Holiday: no brief, no fetching, counters stand still"),
    ("n8n address", "http://localhost:5678",
     "Where n8n is reachable from outside. Links in the brief and Telegram buttons go through it. "
     "On localhost the links open only on this machine, so the workflow drops the wrapper"),
]


def existing_titles(notion: Notion, db_id: str, prop_name: str) -> dict:
    return {plain(p, prop_name): p["id"] for p in notion.query(db_id)}


def main():
    env = load_env()
    state = load_state()
    require(env, "NOTION_TOKEN")
    dbs = {k: env.get(f"NOTION_DB_{k.upper()}") or state.get("databases", {}).get(k)
           for k in ("topics", "sources", "settings")}
    missing = [k for k, v in dbs.items() if not v]
    if missing:
        sys.exit(f"No database ids for: {', '.join(missing)}. Run deploy.py --create-databases first.")

    notion = Notion(env["NOTION_TOKEN"])

    print("Topics")
    have = existing_titles(notion, dbs["topics"], "Topic")
    topic_ids = dict(have)
    for t in TOPICS:
        if t["name"] in have:
            print(f"  {t['name']:<22} already there")
            continue
        page = notion.create_page(dbs["topics"], {
            "Topic": title(t["name"]),
            "Status": select("Active"),
            "Criterion": rich(t["criterion"]),
            "Signals": multi(t["signals"]),
            "Muted": multi(t["muted"]),
            "Languages": multi(t["languages"]),
            "Window": number(24),
            "Threshold": number(t["threshold"]),
            "Priority": select(t["priority"]),
            "Find sources": {"checkbox": False},
        })
        topic_ids[t["name"]] = page["id"]
        print(f"  {t['name']:<22} created"
              + ("   (Signals left empty on purpose: no keyword filter)" if not t["signals"] else ""))

    print("\nSources")
    have = existing_titles(notion, dbs["sources"], "Source")
    for s in SOURCES:
        if s["name"] in have:
            print(f"  {s['name']:<22} already there")
            continue
        notion.create_page(dbs["sources"], {
            "Source": title(s["name"]),
            "Address": {"url": s["url"]},
            "Type": select(s["type"]),
            "Status": select("Active"),
            "Proposed by": select("human"),
            "Failures in a row": number(0),
            "Note": rich(s["note"]),
            "Topics": relation([topic_ids[s["topic"]]]) if topic_ids.get(s["topic"]) else relation([]),
        })
        print(f"  {s['name']:<22} created")

    print("\nSettings")
    have = existing_titles(notion, dbs["settings"], "Key")
    for key, value, note in SETTINGS:
        if key in have:
            print(f"  {key:<22} already there")
            continue
        notion.create_page(dbs["settings"], {
            "Key": title(key), "Value": rich(value), "Note": rich(note),
        })
        print(f"  {key:<22} = {value}")

    print("\n" + "-" * 72)
    print("Two of the three topics have no sources on purpose. Open Topics, tick 'Find sources' on")
    print("Cooking, and watch discovery run: it proposes, fetches each candidate to check it is real")
    print("and still alive, and only then offers it to you.")


if __name__ == "__main__":
    main()
