#!/usr/bin/env python3
"""Print the chat id of whoever last messaged the bot.

    1. write anything to your bot in Telegram ("hi" is enough)
    2. python scripts/telegram_chat_id.py

Needs only TELEGRAM_BOT_TOKEN in .env. Telegram keeps updates for 24 hours, so if nothing shows up,
send the message again and re-run.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import http, load_env, require  # noqa: E402

env = load_env()
require(env, "TELEGRAM_BOT_TOKEN")

status, data = http("GET", f"https://api.telegram.org/bot{env['TELEGRAM_BOT_TOKEN']}/getUpdates")
if not isinstance(data, dict) or not data.get("ok"):
    sys.exit(f"Telegram said no: {data}")

results = data.get("result", [])
if not results:
    sys.exit("No updates. Send your bot a message, then run this again.\n"
             "If the bot is already used by another workflow with a webhook set, getUpdates stays "
             "empty by design — delete the webhook or read the id from that workflow instead.")

seen = {}
for update in results:
    msg = update.get("message") or update.get("edited_message") or {}
    chat = msg.get("chat") or (update.get("callback_query", {}).get("message", {}) or {}).get("chat")
    if chat:
        seen[chat["id"]] = chat.get("title") or " ".join(
            filter(None, [chat.get("first_name"), chat.get("last_name")])) or chat.get("type")

for chat_id, who in seen.items():
    print(f"TELEGRAM_CHAT_ID={chat_id}    # {who}")
