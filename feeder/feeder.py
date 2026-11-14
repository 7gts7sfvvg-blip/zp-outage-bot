#!/usr/bin/env python3
"""Берёт график с zoe.com.ua (сайт открывается только с украинского IP) и, если он изменился,
публикует снимок в ветку site-data репозитория. Бот и кнопки читают этот снимок и берут из него
более свежие данные, чем из Telegram-каналов.

Запуск раз в минуту через launchd (см. install.sh) или вручную: python3 feeder.py
Нужен вход в gh (gh auth login) с правом на репозиторий.
"""
import base64
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import bot  # noqa: E402

REPO = "7gts7sfvvg-blip/zp-outage-bot"
BRANCH = "site-data"
GH = shutil.which("gh") or "/opt/homebrew/bin/gh"
LAST = os.path.expanduser("~/.zp-outage-feeder.json")


def gh(*args, check=True):
    return subprocess.run([GH, *args], capture_output=True, text=True, check=check).stdout.strip()


def main():
    data = bot.fetch_site()
    now = datetime.now(bot.KYIV)
    keep = {(now + timedelta(days=d)).strftime("%d.%m") for d in (-1, 0, 1)}
    data = {d: qs for d, qs in data.items() if d in keep}
    if not data:
        print("график на сайте не найден")
        return
    try:
        with open(LAST, encoding="utf-8") as f:
            if json.load(f) == data:
                return  # ничего не изменилось
    except Exception:
        pass
    snap = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "data": data}
    content = base64.b64encode(json.dumps(snap, ensure_ascii=False, indent=1, sort_keys=True).encode()).decode()
    sha = gh("api", f"repos/{REPO}/contents/site.json?ref={BRANCH}", "--jq", ".sha", check=False)
    args = ["api", "-X", "PUT", f"repos/{REPO}/contents/site.json",
            "-f", "message=site snapshot", "-f", f"content={content}", "-f", f"branch={BRANCH}"]
    if sha:
        args += ["-f", f"sha={sha}"]
    gh(*args)
    with open(LAST, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(snap["at"], "обновлено:", {d: qs.get("4.2") for d, qs in data.items()})


if __name__ == "__main__":
    main()
