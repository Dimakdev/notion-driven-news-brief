#!/usr/bin/env python3
"""One command from a fresh fork to a running brief.

    python scripts/deploy.py --create-databases     first time: builds the six Notion databases too
    python scripts/deploy.py                        after that: credentials, import, activate

What it does, in order:
  1. creates the six databases from schema/notion.json under your NOTION_PARENT_PAGE_ID (two passes,
     because a relation needs the id of a database that does not exist yet on the first pass);
  2. creates the n8n credentials from the keys in .env;
  3. substitutes every __PLACEHOLDER__ in workflow.json with your real ids;
  4. imports the error workflow first, so the main one can point at it, then imports and activates both.

It never writes to .env. Database ids land in .deploy-state.json and are printed as the lines to paste,
because a script that edits the file holding your keys is a script you have to read very carefully.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import (N8n, Notion, HttpError, ROOT, load_env, load_schema, load_state, require,  # noqa: E402
                    save_state)

ORDER = ["topics", "sources", "feed", "runs", "settings", "briefs"]


# ---------------------------------------------------------------- Notion databases
def create_databases(notion: Notion, parent: str, state: dict) -> dict:
    schema = load_schema()
    dbs = state.setdefault("databases", {})

    for key in ORDER:
        spec = schema["databases"][key]
        if dbs.get(key):
            print(f"  {spec['title']:<14} already at {dbs[key]}")
            continue
        props = json.loads(json.dumps(spec["properties"]))
        for name, text in (spec.get("descriptions") or {}).items():
            if name in props:
                props[name]["description"] = text
        created = notion.create_database(parent, spec["title"], props, spec.get("description", ""))
        dbs[key] = created["id"]
        print(f"  {spec['title']:<14} created {created['id']}")
        save_state(state)

    # second pass: relations, now that every id exists
    for rel in schema["relations"]:
        src, dst = dbs[rel["from"]], dbs[rel["to"]]
        existing = notion.get_database(src).get("properties", {})
        if rel["property"] in existing:
            continue
        prop = {rel["property"]: {"relation": {"database_id": dst, "type": "dual_property",
                                               "dual_property": {"synced_property_name": rel["dual"]}}}}
        if rel.get("description"):
            prop[rel["property"]]["description"] = rel["description"]
        notion.update_database(src, prop)
        print(f"  relation {schema['databases'][rel['from']]['title']}.{rel['property']} "
              f"-> {schema['databases'][rel['to']]['title']}")

    save_state(state)
    return dbs


# ---------------------------------------------------------------- n8n credentials
def ensure_credentials(n8n: N8n, env: dict, state: dict, provider: str) -> dict:
    creds = state.setdefault("credentials", {})

    def make(key: str, name: str, cred_type: str, data: dict):
        if creds.get(key):
            print(f"  {name:<24} already at {creds[key]}")
            return
        if not all(data.values()):
            print(f"  {name:<24} skipped, key missing in .env")
            return
        created = n8n.create_credential(name, cred_type, data)
        creds[key] = created["id"]
        print(f"  {name:<24} created {created['id']}")
        save_state(state)

    make("notion", "Notion (brief)", "notionApi", {"apiKey": env.get("NOTION_TOKEN", "")})
    make("telegram", "Telegram bot (brief)", "telegramApi", {"accessToken": env.get("TELEGRAM_BOT_TOKEN", "")})
    if provider == "anthropic":
        make("anthropic", "Anthropic (brief)", "anthropicApi", {"apiKey": env.get("ANTHROPIC_API_KEY", "")})
    else:
        make("gemini", "Google Gemini (brief)", "googlePalmApi",
             {"host": "https://generativelanguage.googleapis.com", "apiKey": env.get("GEMINI_API_KEY", "")})
    return creds


# ---------------------------------------------------------------- workflow import
def substitute(raw: str, mapping: dict) -> str:
    for ph, value in mapping.items():
        raw = raw.replace(ph, str(value))
    return raw


def upsert(n8n: N8n, wf: dict, state_key: str, state: dict) -> str:
    known = state.get("workflows", {}).get(state_key)
    if known:
        try:
            live = n8n.get_workflow(known)
            # Carry the seen-index across the update. It lives in the workflow's static data, and a
            # freshly built workflow.json has none — so redeploying would silently empty the memory of
            # what has already been sent, and the next brief would repeat a week of articles.
            if live.get("staticData"):
                wf["staticData"] = live["staticData"]
            n8n.deactivate(known)          # a workflow cannot be updated while active
            n8n.update_workflow(known, wf)
            print(f"  updated {wf['name']} ({known})")
            return known
        except HttpError as e:
            if e.status != 404:
                raise
            print(f"  {state_key} was gone from n8n, creating a new one")

    created = n8n.create_workflow(wf)
    state.setdefault("workflows", {})[state_key] = created["id"]
    save_state(state)
    print(f"  created {wf['name']} ({created['id']})")
    return created["id"]


def disable_nodes_without_credentials(wf: dict) -> list[str]:
    """n8n refuses to activate a workflow whose node is missing a required credential, and the error
    it gives points at activation, not at the node. Disabling them keeps the rest of the brief alive
    and names what is off, which is the more useful failure."""
    off = []
    for node in wf["nodes"]:
        for cred in (node.get("credentials") or {}).values():
            if str(cred.get("id", "")).startswith("__"):
                node["disabled"] = True
                off.append(node["name"])
                break
    return off


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--create-databases", action="store_true", help="build the six Notion databases first")
    ap.add_argument("--provider", choices=["gemini", "anthropic"], default="gemini")
    ap.add_argument("--no-activate", action="store_true")
    args = ap.parse_args()

    env = load_env()
    state = load_state()
    require(env, "N8N_API_KEY", "N8N_BASE_URL", "NOTION_TOKEN")

    notion = Notion(env["NOTION_TOKEN"])
    n8n = N8n(env["N8N_BASE_URL"], env["N8N_API_KEY"])

    # -------- 1. databases
    print("\nNotion databases")
    if args.create_databases:
        require(env, "NOTION_PARENT_PAGE_ID")
        dbs = create_databases(notion, env["NOTION_PARENT_PAGE_ID"], state)
    else:
        dbs = {k: env.get(f"NOTION_DB_{k.upper()}") or state.get("databases", {}).get(k) for k in ORDER}
        missing = [k for k, v in dbs.items() if not v]
        if missing:
            sys.exit(f"No ids for: {', '.join(missing)}. Run once with --create-databases, "
                     f"or set NOTION_DB_* in .env.")
        print("  using ids from .env / .deploy-state.json")

    # -------- 2. credentials
    print("\nn8n credentials")
    creds = ensure_credentials(n8n, env, state, args.provider)

    # -------- 3 and 4. import
    print("\nworkflows")
    mapping = {
        "__DB_TOPICS__": dbs["topics"], "__DB_SOURCES__": dbs["sources"], "__DB_FEED__": dbs["feed"],
        "__DB_RUNS__": dbs["runs"], "__DB_SETTINGS__": dbs["settings"], "__DB_BRIEFS__": dbs["briefs"],
        "__TELEGRAM_CHAT_ID__": env.get("TELEGRAM_CHAT_ID", ""),
        "__NOTION_CRED_ID__": creds.get("notion", "__NOTION_CRED_ID__"),
        "__TELEGRAM_CRED_ID__": creds.get("telegram", "__TELEGRAM_CRED_ID__"),
        "__GEMINI_CRED_ID__": creds.get("gemini", "__GEMINI_CRED_ID__"),
        "__ANTHROPIC_CRED_ID__": creds.get("anthropic", "__ANTHROPIC_CRED_ID__"),
    }

    err_wf = json.loads(substitute((ROOT / "error-workflow.json").read_text(encoding="utf-8"),
                                   {**mapping, "__ERROR_WORKFLOW_ID__": ""}))
    err_off = disable_nodes_without_credentials(err_wf)
    err_id = upsert(n8n, err_wf, "error", state)

    main_wf = json.loads(substitute((ROOT / "workflow.json").read_text(encoding="utf-8"),
                                    {**mapping, "__ERROR_WORKFLOW_ID__": err_id}))
    main_off = disable_nodes_without_credentials(main_wf)
    main_id = upsert(n8n, main_wf, "main", state)

    if not args.no_activate:
        # The error workflow must be active or n8n silently ignores it — learned the hard way in the
        # Lead -> CRM case, where a failing run alerted nobody for a day.
        for wf_id, label in ((err_id, "error workflow"), (main_id, "main workflow")):
            try:
                n8n.activate(wf_id)
                print(f"  activated {label}")
            except HttpError as e:
                print(f"  could NOT activate {label}: {e}")

    # -------- what the person still has to do
    print("\n" + "-" * 72)
    if args.create_databases:
        print("Add these to .env (this script does not touch that file):\n")
        for key in ORDER:
            print(f"NOTION_DB_{key.upper()}={dbs[key]}")
        print()
    for name in set(err_off + main_off):
        print(f"! node disabled, its credential is missing: {name}")
    base = env.get("PUBLIC_BASE_URL", env["N8N_BASE_URL"]).rstrip("/")
    print(f"\nLink tracking and Telegram buttons answer at {base}/webhook/r")
    if "localhost" in base:
        print("  localhost: links in the brief will only open on this machine. Put n8n behind a public")
        print("  URL and set PUBLIC_BASE_URL to read the brief on a phone.")
    print(f"\nSeed the control panel:  python scripts/seed_notion.py")
    print(f"Then try one run:        python scripts/run_tests.py --case brief")


if __name__ == "__main__":
    main()
