"""Shared helpers for deploy.py, seed_notion.py and run_tests.py: .env loading, n8n API, Notion API,
state file. Standard library only (urllib), Python 3.10+.

Carried over from the Lead -> CRM case with the data layer swapped: same .env handling, same n8n client,
Airtable replaced by Notion.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / ".deploy-state.json"
SCHEMA_FILE = ROOT / "schema" / "notion.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_env(path: pathlib.Path = ROOT / ".env") -> dict:
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k, v in os.environ.items():
        env.setdefault(k, v)
    return env


def require(env: dict, *keys: str) -> None:
    missing = [k for k in keys if not env.get(k)]
    if missing:
        sys.exit(f"Missing in .env: {', '.join(missing)}")


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_schema() -> dict:
    return json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))


class HttpError(Exception):
    def __init__(self, status: int, body: str, url: str):
        super().__init__(f"HTTP {status} for {url}: {body[:800]}")
        self.status = status
        self.body = body


def http(method: str, url: str, headers: dict | None = None, body=None, timeout: int = 60):
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        raise HttpError(e.code, raw, url) from None


class N8n:
    def __init__(self, base_url: str, api_key: str):
        self.base = base_url.rstrip("/")
        self.headers = {"X-N8N-API-KEY": api_key, "Accept": "application/json"}

    def call(self, method: str, path: str, body=None, timeout: int = 60):
        return http(method, f"{self.base}/api/v1{path}", self.headers, body, timeout)[1]

    def list_workflows(self):
        return self.call("GET", "/workflows?limit=250").get("data", [])

    def get_workflow(self, wf_id: str):
        return self.call("GET", f"/workflows/{wf_id}")

    def create_workflow(self, wf: dict):
        return self.call("POST", "/workflows", body=api_body(wf))

    def update_workflow(self, wf_id: str, wf: dict):
        return self.call("PUT", f"/workflows/{wf_id}", body=api_body(wf))

    def activate(self, wf_id: str):
        return self.call("POST", f"/workflows/{wf_id}/activate")

    def deactivate(self, wf_id: str):
        return self.call("POST", f"/workflows/{wf_id}/deactivate")

    def credential_schema(self, cred_type: str):
        return self.call("GET", f"/credentials/schema/{cred_type}")

    def create_credential(self, name: str, cred_type: str, data: dict):
        return self.call("POST", "/credentials", body={"name": name, "type": cred_type, "data": data})

    def executions(self, wf_id: str, limit: int = 5, include_data: bool = True):
        q = f"?workflowId={wf_id}&limit={limit}&includeData={'true' if include_data else 'false'}"
        return self.call("GET", f"/executions{q}").get("data", [])


def api_body(wf: dict) -> dict:
    """The public API rejects unknown top-level keys: keep only what it accepts."""
    allowed_settings = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution",
                        "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone",
                        "executionOrder"}
    return {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": {k: v for k, v in wf.get("settings", {}).items() if k in allowed_settings},
        "staticData": wf.get("staticData"),
    }


class Notion:
    """Thin Notion client. Only what deploy/seed/tests need, nothing more.

    Rate limit is roughly 3 requests per second, and creating a schema means a burst of them, so every
    call goes through a small pacer and retries a 429 instead of dying halfway through a build.
    """

    API = "https://api.notion.com/v1"
    VERSION = "2022-06-28"
    MIN_INTERVAL = 0.34

    def __init__(self, token: str):
        self.headers = {"Authorization": f"Bearer {token}", "Notion-Version": self.VERSION}
        self._last = 0.0

    def call(self, method: str, path: str, body=None, attempts: int = 4):
        for attempt in range(attempts):
            gap = time.monotonic() - self._last
            if gap < self.MIN_INTERVAL:
                time.sleep(self.MIN_INTERVAL - gap)
            self._last = time.monotonic()
            try:
                return http(method, f"{self.API}{path}", self.headers, body)[1]
            except HttpError as e:
                if e.status in (429, 502, 503) and attempt < attempts - 1:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise

    # -------------------------------------------------------------- databases
    def create_database(self, parent_page_id: str, title: str, properties: dict, description: str = "") -> dict:
        body = {
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"type": "text", "text": {"content": title}}],
            "properties": properties,
        }
        if description:
            body["description"] = [{"type": "text", "text": {"content": description}}]
        return self.call("POST", "/databases", body)

    def update_database(self, database_id: str, properties: dict) -> dict:
        return self.call("PATCH", f"/databases/{database_id}", {"properties": properties})

    def get_database(self, database_id: str) -> dict:
        return self.call("GET", f"/databases/{database_id}")

    def query(self, database_id: str, filter_: dict | None = None, page_size: int = 100) -> list[dict]:
        out, cursor = [], None
        while True:
            body = {"page_size": page_size}
            if filter_:
                body["filter"] = filter_
            if cursor:
                body["start_cursor"] = cursor
            data = self.call("POST", f"/databases/{database_id}/query", body)
            out.extend(data.get("results", []))
            if not data.get("has_more"):
                return out
            cursor = data.get("next_cursor")

    # -------------------------------------------------------------- pages
    def create_page(self, database_id: str, properties: dict, children: list | None = None) -> dict:
        body = {"parent": {"database_id": database_id}, "properties": properties}
        if children:
            body["children"] = children[:100]
        return self.call("POST", "/pages", body)

    def update_page(self, page_id: str, properties: dict) -> dict:
        return self.call("PATCH", f"/pages/{page_id}", {"properties": properties})

    def append_blocks(self, page_id: str, children: list) -> dict:
        # Notion accepts at most 100 blocks per call; a long brief is appended in slices.
        last = {}
        for i in range(0, len(children), 100):
            last = self.call("PATCH", f"/blocks/{page_id}/children", {"children": children[i:i + 100]})
        return last


# ------------------------------------------------------------------ property helpers
def title(text: str) -> dict:
    return {"title": [{"type": "text", "text": {"content": str(text)[:2000]}}]}


def rich(text: str) -> dict:
    return {"rich_text": [{"type": "text", "text": {"content": str(text)[:2000]}}]} if text else {"rich_text": []}


def select(name: str | None) -> dict:
    return {"select": {"name": name} if name else None}


def multi(names: list[str]) -> dict:
    return {"multi_select": [{"name": n} for n in names]}


def number(value) -> dict:
    return {"number": None if value is None else float(value)}


def relation(ids: list[str]) -> dict:
    return {"relation": [{"id": i} for i in ids]}


def checkbox(value: bool) -> dict:
    return {"checkbox": bool(value)}


def plain(page: dict, name: str):
    """Read one property off a Notion page object, whatever its type."""
    p = (page.get("properties") or {}).get(name)
    if not p:
        return None
    kind = p.get("type")
    if kind in ("title", "rich_text"):
        return "".join(t.get("plain_text", "") for t in p.get(kind) or [])
    if kind == "select":
        return (p.get("select") or {}).get("name")
    if kind == "multi_select":
        return [o["name"] for o in p.get("multi_select") or []]
    if kind == "relation":
        return [r["id"] for r in p.get("relation") or []]
    if kind == "date":
        return (p.get("date") or {}).get("start")
    return p.get(kind)
