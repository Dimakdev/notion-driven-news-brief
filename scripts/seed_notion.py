#!/usr/bin/env python3
"""Fill a fresh control panel with enough to see the thing work.

    python scripts/seed_notion.py

Three topics, two sources, eight settings. Idempotent: rows that already exist by name are left alone,
so running it twice is safe.

Why only the first topic gets sources: the other two are deliberately left empty so that the first
thing a new fork does is tick "🔍 Знайти джерела" and watch the discovery run — propose, verify by
actually fetching, approve. That flow is the point of the case and it is better seen than described.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import (Notion, load_env, load_state, multi, number, plain, relation, require,  # noqa: E402
                    rich, select, title)

TOPICS = [
    {
        "name": "AI та автоматизація",
        "criterion": ("Агенти, оркестрація, інструменти автоматизації, релізи моделей і те, що змінює "
                      "вартість або спосіб роботи. Цікавить конкретика: що саме змінилось і що з цим "
                      "робити. Не цікавлять прогнози про майбутнє без деталей і корпоративні новини."),
        "signals": ["ai agents", "agent", "llm", "automation", "n8n", "workflow", "open source",
                    "anthropic", "openai", "gemini", "model release", "rag", "mcp"],
        "minus": ["crypto", "nft", "funding round", "series a", "gadget review"],
        "languages": ["en", "uk"],
        "priority": "🔥 High",
        "threshold": 60,
    },
    {
        "name": "Кулінарія",
        "criterion": ("Техніки, рецепти, розбори того, чому щось працює на кухні, огляди обладнання, "
                      "яке справді варте грошей. Не цікавлять ресторанні новини, дієти для схуднення "
                      "і списки «10 найкращих» без пояснень."),
        "signals": [],  # deliberately empty: shows what "no keyword filter, let the model decide" does
        "minus": ["diet", "weight loss", "restaurant opening"],
        "languages": ["en", "uk"],
        "priority": "⚡ Medium",
        "threshold": 65,
    },
    {
        "name": "Космос",
        "criterion": ("Запуски, місії, телескопи, знахідки. Цікавить те, що сталося насправді, з даними. "
                      "Не цікавлять чутки про позаземне життя і перекази чужих пресрелізів."),
        "signals": ["launch", "nasa", "spacex", "telescope", "mission", "orbit", "astronomy", "rover"],
        "minus": ["ufo", "alien", "conspiracy"],
        "languages": ["en"],
        "priority": "💤 Low",
        "threshold": 70,
    },
]

SOURCES = [
    {"name": "Hacker News", "url": "https://news.ycombinator.com/rss", "type": "hn",
     "topic": "AI та автоматизація",
     "note": ("Заголовки пише не автор статті, а той, хто запостив, тому відсів за словами тут слабший. "
              "Адаптер дивиться на домен статті за посиланням.")},
    {"name": "TechCrunch AI", "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
     "type": "rss", "topic": "AI та автоматизація",
     "note": "Тематичний фід, найчистіший зі стартового набору."},
]

SETTINGS = [
    ("Час брифу", "05:00", "Коли приходить бриф, локальний час контейнера"),
    ("Канал", "telegram", "telegram / whatsapp / email"),
    ("Тижневий розбір", "увімкнено",
     "увімкнено / вимкнено. Раз на тиждень список пунктів — познач шум. Єдине місце, де щось треба тиснути"),
    ("День розбору", "неділя", "Коли приходить тижневий розбір"),
    ("Розбір зараз", "ні", "Постав «так» — розбір прийде найближчим прогоном, потім скинеться"),
    ("Стеля бюджету", "250",
     "Максимум кандидатів у модель за прогін. Захист від рахунку, не від кількості пунктів"),
    ("Вікно памʼяті", "30", "Скільки днів тримати хеші надісланого. Старше може прийти вдруге"),
    ("Пауза", "вимкнено", "Відпустка: бриф не приходить, збір не йде, лічильники стоять"),
    ("Адреса n8n", "http://localhost:5678",
     "Адреса, за якою n8n досяжний ззовні. Через неї йдуть посилання в брифі і кнопки Telegram. "
     "На localhost посилання відкриваються тільки на цій машині"),
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
    have = existing_titles(notion, dbs["topics"], "Тема")
    topic_ids = dict(have)
    for t in TOPICS:
        if t["name"] in have:
            print(f"  {t['name']:<22} already there")
            continue
        page = notion.create_page(dbs["topics"], {
            "Тема": title(t["name"]),
            "Статус": select("Активна"),
            "Критерій": rich(t["criterion"]),
            "Сигнали": multi(t["signals"]),
            "Мінус-сигнали": multi(t["minus"]),
            "Мови": multi(t["languages"]),
            "Вікно": number(24),
            "Поріг": number(t["threshold"]),
            "Пріоритет": select(t["priority"]),
            "🔍 Знайти джерела": {"checkbox": False},
        })
        topic_ids[t["name"]] = page["id"]
        print(f"  {t['name']:<22} created"
              + ("   (Сигнали порожні — фільтр за словами вимкнено навмисне)" if not t["signals"] else ""))

    print("\nSources")
    have = existing_titles(notion, dbs["sources"], "Джерело")
    for s in SOURCES:
        if s["name"] in have:
            print(f"  {s['name']:<22} already there")
            continue
        notion.create_page(dbs["sources"], {
            "Джерело": title(s["name"]),
            "Адреса": {"url": s["url"]},
            "Тип": select(s["type"]),
            "Статус": select("Активне"),
            "Хто запропонував": select("людина"),
            "Поспіль невдач": number(0),
            "Нотатка": rich(s["note"]),
            "Теми": relation([topic_ids[s["topic"]]]) if topic_ids.get(s["topic"]) else relation([]),
        })
        print(f"  {s['name']:<22} created")

    print("\nSettings")
    have = existing_titles(notion, dbs["settings"], "Ключ")
    for key, value, note in SETTINGS:
        if key in have:
            print(f"  {key:<22} already there")
            continue
        notion.create_page(dbs["settings"], {
            "Ключ": title(key), "Значення": rich(value), "Опис": rich(note),
        })
        print(f"  {key:<22} = {value}")

    print("\n" + "-" * 72)
    print("Two of the three topics have no sources on purpose. Open Теми, tick «🔍 Знайти джерела» on")
    print("Кулінарія, and watch the discovery run: it proposes, fetches each candidate to check it is")
    print("real and still alive, and only then offers it to you.")


if __name__ == "__main__":
    main()
