#!/usr/bin/env python3
"""Telegram-бот: следит за графиком отключений света (ГПВ) в Запорожье, очередь 4.2.

Источник: https://www.zoe.com.ua/outage/ (Запоріжжяобленерго).
Пишет в Telegram, когда график на день появился или изменился.

Запуск:
  TG_TOKEN=... TG_CHAT_ID=... python3 bot.py          # постоянно, проверка каждые 5 минут
  TG_TOKEN=... TG_CHAT_ID=... python3 bot.py --once   # одна проверка (для cron)
  TG_TOKEN=... python3 bot.py --chat-id               # узнать свой chat id
Без зависимостей, только стандартная библиотека.
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

QUEUE = os.environ.get("QUEUE", "4.2")
URL = "https://www.zoe.com.ua/outage/"
INTERVAL = int(os.environ.get("INTERVAL", "300"))
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")
TOKEN = os.environ.get("TG_TOKEN", "")
CHAT = os.environ.get("TG_CHAT_ID", "")


def http(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if attempt == 3:
                raise
            print(f"попытка {attempt + 1} не удалась: {e}")
            time.sleep(5)


CHANNEL = os.environ.get("CHANNEL", "Zaporizhzhyaoblenergo_news,ProZaporizhzhia")  # через запятую
SOURCE = os.environ.get("SOURCE", "channel")  # channel | site
MONTHS = {m: i + 1 for i, m in enumerate(
    "січня лютого березня квітня травня червня липня серпня вересня жовтня листопада грудня".split())}


def _post_date(text):
    m = re.search(r"(\d{1,2})\.(\d{2})\.\d{4}", text)
    if m:
        return f"{int(m.group(1)):02d}.{m.group(2)}"
    m = re.search(r"(\d{1,2})\s+(" + "|".join(MONTHS) + r")", text, flags=re.I)
    if m:
        return f"{int(m.group(1)):02d}.{MONTHS[m.group(2).lower()]:02d}"
    return None


SPAN = r"(\d{1,2}:\d{2})\s*(?:до|[–-])\s*(\d{1,2}:\d{2})"


def _channel_posts(channel):
    """Посты публичного канала: [(время поста UTC, текст)]."""
    page = http(f"https://t.me/s/{channel}")
    posts = []
    for chunk in page.split('data-post="')[1:]:
        m = re.search(r'class="tgme_widget_message_text[^>]*>(.*?)</div>', chunk, flags=re.S)
        t = re.search(r'datetime="([^"]+)"', chunk)
        if m and t:
            text = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", m.group(1))))
            posts.append((datetime.fromisoformat(t.group(1)), text))
    return posts


def _parse_post(posted, text):
    """(дата 'дд.мм', часы) или None. Понимает форматы «Черга 4.2 з .. до ..» и «4.2: 16:00 – 21:00»."""
    kyiv = posted.astimezone(ZoneInfo("Europe/Kyiv"))
    if re.search(r"Черга\s+\d\.\d", text):
        date = _post_date(text)
        q = re.search(r"Черга\s+" + re.escape(QUEUE) + r"(?!\d)(.*?)(?=Черга\s+\d|\Z)", text, flags=re.S)
        spans = re.findall(SPAN, q.group(1)) if q else []
    elif re.search(r"(?<![\d.])\d\.\d:\s*\d{1,2}:\d{2}", text):
        low = text.lower()
        date = _post_date(text) or (
            (kyiv + timedelta(days=1)).strftime("%d.%m") if "завтра" in low
            else kyiv.strftime("%d.%m") if "сьогодні" in low else None)
        q = re.search(r"(?<![\d.])" + re.escape(QUEUE) + r":\s*((?:" + SPAN + r"(?:\s*,\s*)?)+)", text)
        spans = re.findall(SPAN, q.group(1)) if q else []
    else:
        return None
    if not date:
        return None
    return date, ", ".join(f"{a} – {b}" for a, b in spans) if spans else "отключений нет"


def fetch_channel():
    """Читает публичные каналы; для каждой даты берёт самый свежий пост среди всех каналов."""
    latest = {}  # дата -> (время поста, часы)
    for ch in [c.strip() for c in CHANNEL.split(",") if c.strip()]:
        try:
            posts = _channel_posts(ch)
        except Exception as e:
            print(f"канал {ch} недоступен: {e}")
            continue
        for posted, text in posts:
            r = _parse_post(posted, text)
            if r and (r[0] not in latest or posted > latest[r[0]][0]):
                latest[r[0]] = (posted, r[1])
    return {d: h for d, (_, h) in latest.items()}


def fetch_schedules():
    return fetch_site() if SOURCE == "site" else fetch_channel()


def fetch_site():
    """Возвращает {'12 листопада': '17:30 – 22:30'} — самая свежая публикация на каждую дату."""
    raw = http(URL)
    raw = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    text = re.sub(r"\s+", " ", text)
    result = {}
    # Посты идут от новых к старым; берём первый для каждой даты.
    for seg in re.split(r"ОНОВЛЕНО ГПВ НА ", text)[1:]:
        m = re.match(r"(\d{1,2})\s+([А-Яа-яІіЇїЄєҐґ]+)", seg)
        if not m:
            continue
        key = f"{m.group(1)} {m.group(2).lower()}"
        if key in result:
            continue
        q = re.search(
            r"(?<![\d.])" + re.escape(QUEUE) + r":\s*((?:\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}(?:\s*,\s*)?)+)",
            seg,
        )
        if q:
            result[key] = re.sub(r"\s*[–-]\s*", " – ", q.group(1)).strip(" ,")
    return result


def send(msg):
    body = urllib.parse.urlencode({"chat_id": CHAT, "text": msg}).encode()
    http(f"https://api.telegram.org/bot{TOKEN}/sendMessage", body)


def load_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_state(s):
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=1)


def check():
    new = fetch_schedules()
    today = datetime.now(ZoneInfo("Europe/Kyiv"))
    keys = set()
    for day in (today, today + timedelta(days=1)):
        keys |= {day.strftime("%d.%m"), f"{day.day} {list(MONTHS)[day.month - 1]}"}
    new = {d: h for d, h in new.items() if d in keys}  # только сегодня и завтра
    if not new:
        print("график не найден на странице (формат мог измениться)")
        return
    old = load_state()
    if old is None:
        lines = [f"{d}: {h}" for d, h in new.items()]
        send(f"✅ Бот запущен. Очередь {QUEUE}, Запорожье.\nСейчас в графике:\n" + "\n".join(lines))
    else:
        for d, h in new.items():
            if d not in old:
                send(f"💡 Очередь {QUEUE}: новый график на {d}\nОтключения: {h}")
            elif old[d] != h:
                send(f"⚠️ Очередь {QUEUE}: график на {d} изменён\nБыло: {old[d]}\nСтало: {h}")
        for d in old:
            if d not in new:
                pass  # старая дата пропала со страницы — молчим
    save_state(new)
    print(time.strftime("%H:%M:%S"), new)


def main():
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]+", TOKEN):
        sys.exit("TG_TOKEN выглядит неправильно: нужен настоящий токен вида 123456789:AA... "
                 "(не текст-заглушка из инструкции)")
    if "--chat-id" in sys.argv:
        data = json.loads(http(f"https://api.telegram.org/bot{TOKEN}/getUpdates"))
        ids = {u["message"]["chat"]["id"] for u in data["result"] if "message" in u}
        print("chat id:", ids or "пусто — сначала напишите боту любое сообщение")
        return
    if not TOKEN or not CHAT:
        sys.exit("Задайте TG_TOKEN и TG_CHAT_ID (см. README.md)")
    if "--once" in sys.argv:
        check()
        return
    while True:
        try:
            check()
        except Exception as e:
            print("ошибка:", e)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
