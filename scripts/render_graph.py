#!/usr/bin/env python3
"""Draw workflow.json as an SVG.

    python scripts/render_graph.py

A screenshot of the n8n canvas goes stale the moment a node moves, and it is a dark picture with the
node names cut off. This reads the same file the workflow is built from, so the picture cannot drift
from the graph, it stays readable at any zoom, and it lives in git as text you can diff.

Writes docs/images/workflow.svg and docs/images/workflow-daily.svg (the daily chain on its own).
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images"

# One colour per kind of work, so the shape of the thing is readable before any label is.
COLOURS = {
    "trigger": ("#2f6f4f", "#d7f0e2"),
    "code": ("#8a5a00", "#ffeccc"),
    "http": ("#2b5f9e", "#d9e8fb"),
    "model": ("#6b3fa0", "#ece0f8"),
    "telegram": ("#1d7fa8", "#d6f0fa"),
    "control": ("#5a5f6a", "#e9ebef"),
}

BOX_W, BOX_H = 150, 48
PAD = 90
FONT = "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif"


def kind(node: dict) -> str:
    t = node["type"]
    if "rigger" in t or t.endswith("webhook"):
        return "trigger"
    if t.endswith(".code"):
        return "code"
    if t.endswith("httpRequest"):
        return "http"
    if "langchain" in t:
        return "model"
    if t.endswith("telegram"):
        return "telegram"
    return "control"


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def wrap(name: str, width: int = 19) -> list[str]:
    words, lines, cur = name.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= width:
            cur = f"{cur} {w}".strip()
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:2]


def render(nodes: list[dict], connections: dict, title: str, subtitle: str) -> str:
    pos = {n["name"]: (n["position"][0], n["position"][1]) for n in nodes}
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    minx, miny = min(xs) - PAD, min(ys) - PAD
    w = max(xs) - minx + BOX_W + PAD
    h = max(ys) - miny + BOX_H + PAD + 60

    def X(v):
        return round(v - minx, 1)

    def Y(v):
        return round(v - miny + 60, 1)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(w)} {round(h)}" '
        f'width="{round(w)}" height="{round(h)}" font-family="{FONT}">',
        '<style>'
        '.bg{fill:#ffffff}.t{fill:#111827}.s{fill:#6b7280}'
        '@media (prefers-color-scheme: dark){.bg{fill:#0d1117}.t{fill:#e6edf3}.s{fill:#9198a1}'
        '.box{filter:brightness(.82)}.edge{stroke:#6b7280}}'
        '</style>',
        f'<rect class="bg" width="{round(w)}" height="{round(h)}"/>',
        f'<text class="t" x="16" y="30" font-size="19" font-weight="600">{esc(title)}</text>',
        f'<text class="s" x="16" y="50" font-size="13">{esc(subtitle)}</text>',
    ]

    # edges first, so boxes sit on top of them
    names = set(pos)
    for src, kinds in connections.items():
        if src not in names:
            continue
        for groups in kinds.values():
            for group in groups:
                for link in group:
                    dst = link["node"]
                    if dst not in names:
                        continue
                    x1, y1 = X(pos[src][0]) + BOX_W, Y(pos[src][1]) + BOX_H / 2
                    x2, y2 = X(pos[dst][0]), Y(pos[dst][1]) + BOX_H / 2
                    mid = (x1 + x2) / 2
                    parts.append(
                        f'<path class="edge" d="M{x1},{y1} C{mid},{y1} {mid},{y2} {x2},{y2}" '
                        f'fill="none" stroke="#9aa4b2" stroke-width="1.6" opacity=".85"/>')

    for n in nodes:
        k = kind(n)
        stroke, fill = COLOURS[k]
        x, y = X(pos[n["name"]][0]), Y(pos[n["name"]][1])
        parts.append(
            f'<rect class="box" x="{x}" y="{y}" width="{BOX_W}" height="{BOX_H}" rx="8" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
        lines = wrap(n["name"])
        top = y + (BOX_H / 2) - (len(lines) - 1) * 7 + 4
        for i, line in enumerate(lines):
            parts.append(
                f'<text x="{x + BOX_W / 2}" y="{top + i * 14}" text-anchor="middle" '
                f'font-size="11.5" fill="{stroke}" font-weight="600">{esc(line)}</text>')

    # legend
    lx = 16
    for k, (stroke, fill) in COLOURS.items():
        parts.append(f'<rect x="{lx}" y="{h - 26}" width="11" height="11" rx="3" fill="{fill}" '
                     f'stroke="{stroke}" stroke-width="1.4"/>')
        label = {"http": "Notion / fetch", "model": "model", "code": "code",
                 "trigger": "trigger", "telegram": "delivery", "control": "control"}[k]
        parts.append(f'<text class="s" x="{lx + 17}" y="{h - 17}" font-size="11.5">{label}</text>')
        lx += 22 + len(label) * 6.6

    parts.append("</svg>")
    return "\n".join(parts)


def main():
    wf = json.loads((ROOT / "workflow.json").read_text(encoding="utf-8"))
    nodes = [n for n in wf["nodes"] if not n["type"].endswith("stickyNote")]
    OUT.mkdir(parents=True, exist_ok=True)

    full = render(nodes, wf["connections"], "Notion-driven news brief",
                  f"{len(nodes)} nodes. Generated from workflow.json by scripts/render_graph.py")
    (OUT / "workflow.svg").write_text(full, encoding="utf-8")

    # The daily chain on its own: the part anyone reading the README actually wants to follow.
    daily = [n for n in nodes if n["position"][1] < 400 and n["position"][0] < 6100]
    keep = {n["name"] for n in daily}
    conns = {s: {k: [[l for l in g if l["node"] in keep] for g in gs] for k, gs in ks.items()}
             for s, ks in wf["connections"].items() if s in keep}
    (OUT / "workflow-daily.svg").write_text(
        render(daily, conns, "The daily brief, end to end",
               "Settings gate, fetch, two-stage filter, write-up, delivery, memory, log"),
        encoding="utf-8")

    for f in ("workflow.svg", "workflow-daily.svg"):
        print(f"docs/images/{f}  {(OUT / f).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
