#!/usr/bin/env python3
"""Telegram-бот: следит за графиком отключений света (ГПВ) в Запорожье и пишет подписчикам
о появлении и изменении графика для их очереди (сегодня и завтра).

Источники: публичные Telegram-каналы (CHANNEL, через запятую) или сайт zoe.com.ua (SOURCE=site).
Подписчики и их очереди хранит Vercel-функция (SUBS_URL).

  TG_TOKEN=... TG_CHAT_ID=... python3 bot.py --once   # одна проверка (GitHub Actions / cron)
  TG_TOKEN=... TG_CHAT_ID=... python3 bot.py          # постоянно, раз в INTERVAL секунд
Без зависимостей, только стандартная библиотека.
"""
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

KYIV = ZoneInfo("Europe/Kyiv")
QUEUES = [f"{a}.{b}" for a in range(1, 7) for b in (1, 2)]
DEFAULT_QUEUE = os.environ.get("QUEUE", "4.2")
CHANNEL = os.environ.get("CHANNEL", "Zaporizhzhyaoblenergo_news,ProZaporizhzhia")  # через запятую
SOURCE = os.environ.get("SOURCE", "channel")  # channel | site
SITE = "https://www.zoe.com.ua/outage/"
INTERVAL = int(os.environ.get("INTERVAL", "300"))
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")
TOKEN = os.environ.get("TG_TOKEN", "")
CHAT = os.environ.get("TG_CHAT_ID", "")
SUBS_URL = os.environ.get("SUBS_URL", "")
SUBS_SECRET = os.environ.get("SUBS_SECRET", "")
MONTHS = {m: i + 1 for i, m in enumerate(
    "січня лютого березня квітня травня червня липня серпня вересня жовтня листопада грудня".split())}
SPAN = r"(\d{1,2}:\d{2})\s*(?:до|[–-])\s*(\d{1,2}:\d{2})"


def http(url, data=None, headers=None):
    h = {"User-Agent": "Mozilla/5.0"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError:
            raise
        except Exception as e:
            if attempt == 3:
                raise
            print(f"попытка {attempt + 1} не удалась: {e}")
            time.sleep(5)


def _post_date(text):
    m = re.search(r"(\d{1,2})\.(\d{2})\.\d{4}", text)
    if m:
        return f"{int(m.group(1)):02d}.{m.group(2)}"
    m = re.search(r"(\d{1,2})\s+(" + "|".join(MONTHS) + r")", text, flags=re.I)
    if m:
        return f"{int(m.group(1)):02d}.{MONTHS[m.group(2).lower()]:02d}"
    return None


def parse_queues(text):
    """{очередь: 'чч:мм – чч:мм, ...'} для очередей, про которые пост что-то знает.
    Очередь, которой нет в полном списке (есть 6.2), означает «отключений нет»;
    в обрезанном посте отсутствующая очередь неизвестна и пропускается."""
    found = {}
    if re.search(r"Черга\s+\d\.\d", text):  # «Черга 4.2 з 00:00 до 01:00 …»
        for q, body in re.findall(r"Черга\s+(\d\.\d)(.*?)(?=Черга\s+\d\.\d|\Z)", text, flags=re.S):
            spans = []
            for line in body.strip().split("\n"):  # только подряд идущие строки «з .. до ..»
                m = re.fullmatch(r"\s*з\s*" + SPAN + r"\s*\.?", line)
                if not m:
                    break
                spans.append((m.group(1), m.group(2)))
            found[q] = spans
    else:  # «4.2: 16:00 – 21:00, …»
        span_nc = SPAN.replace("(\\d", "(?:\\d")
        for q, body in re.findall(r"(?<![\d.:])(\d\.\d):((?:\s*" + span_nc + r"\s*,?)*)", text):
            found[q] = re.findall(SPAN, body)
    if not found:
        return {}
    complete = "6.2" in found or bool(re.search(r"(?<![\d.])6\.2", text))
    out = {}
    for q in QUEUES:
        if q in found and found[q]:
            out[q] = ", ".join(f"{a} – {b}" for a, b in found[q])
        elif q in found or complete:
            out[q] = "отключений нет"
    return out


def _channel_posts(channel):
    page = http(f"https://t.me/s/{channel}")
    posts = []
    for chunk in page.split('data-post="')[1:]:
        m = re.search(r'class="tgme_widget_message_text[^>]*>(.*?)</div>', chunk, flags=re.S)
        t = re.search(r'datetime="([^"]+)"', chunk)
        if m and t:
            text = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", m.group(1))))
            posts.append((datetime.fromisoformat(t.group(1)), text))
    return posts


def _post_day(posted, text):
    kyiv = posted.astimezone(KYIV)
    d = _post_date(text)
    if d:
        return d
    low = text.lower()
    if "завтра" in low:
        return (kyiv + timedelta(days=1)).strftime("%d.%m")
    if "сьогодні" in low or "сегодня" in low:
        return kyiv.strftime("%d.%m")
    return None


SNAPSHOT_URL = os.environ.get(
    "SNAPSHOT_URL", "https://raw.githubusercontent.com/7gts7sfvvg-blip/zp-outage-bot/site-data/site.json")


def snapshot_into(latest):
    """Добавляет данные сайта, присланные устройством в Украине (feeder): побеждает более свежее по времени."""
    try:
        snap = json.loads(http(f"{SNAPSHOT_URL}?t={int(time.time() // 60)}"))
        at = datetime.fromisoformat(snap["at"])
    except Exception:
        return
    for day, qs in snap.get("data", {}).items():
        for q, hours in qs.items():
            if (day, q) not in latest or at > latest[(day, q)][0]:
                latest[(day, q)] = (at, hours)


def fetch_channels():
    """{дата: {очередь: часы}} — для каждой пары (дата, очередь) самый свежий источник:
    посты каналов или снимок сайта."""
    latest = {}  # (дата, очередь) -> (время, часы)
    for ch in [c.strip() for c in CHANNEL.split(",") if c.strip()]:
        try:
            posts = _channel_posts(ch)
        except Exception as e:
            print(f"канал {ch} недоступен: {e}")
            continue
        for posted, text in posts:
            parsed = parse_queues(text)
            day = _post_day(posted, text) if parsed else None
            if not day:
                continue
            for q, hours in parsed.items():
                if (day, q) not in latest or posted > latest[(day, q)][0]:
                    latest[(day, q)] = (posted, hours)
    snapshot_into(latest)
    out = {}
    for (day, q), (_, hours) in latest.items():
        out.setdefault(day, {})[q] = hours
    return out


def fetch_site():
    """Читает zoe.com.ua (работает только с украинского IP). Первая публикация на дату — самая свежая."""
    raw = re.sub(r"<script.*?</script>|<style.*?</style>", " ", http(SITE), flags=re.S)
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw)))
    out = {}
    for seg in re.split(r"ОНОВЛЕНО ГПВ НА ", text)[1:]:
        day = _post_date(seg[:40].lower())
        if day and day not in out:
            parsed = parse_queues(seg)
            if parsed:
                out[day] = parsed
    return out


def fetch_schedules():
    return fetch_site() if SOURCE == "site" else fetch_channels()


def tg_send(chat, msg):
    body = urllib.parse.urlencode({"chat_id": chat, "text": msg}).encode()
    http(f"https://api.telegram.org/bot{TOKEN}/sendMessage", body)


def subscribers():
    """[(chat_id, очередь)] от Vercel-функции; при сбое — только владелец."""
    fallback = [(CHAT, DEFAULT_QUEUE)] if CHAT else []
    if not SUBS_URL:
        return fallback
    try:
        data = json.loads(http(SUBS_URL, headers={"x-subs-secret": SUBS_SECRET}))
        subs = [(str(c), q) for c, v in data.items() if not v.get("mute")
                for q in (v.get("qs") or [v.get("q")]) if q in QUEUES]
        return subs
    except Exception as e:
        print("не удалось получить подписчиков:", e)
        return fallback


def load_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            s = json.load(f)
    except Exception:
        return None
    # старый формат {дата: "часы для 4.2"} -> {дата: {"4.2": часы}}
    return {d: (v if isinstance(v, dict) else {DEFAULT_QUEUE: v}) for d, v in s.items()}


def save_state(s):
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=1, sort_keys=True)


def notify(subs, queue, text):
    for chat, q in subs:
        if q == queue:
            try:
                tg_send(chat, text)
            except Exception as e:
                print(f"не отправлено {chat}: {e}")


def check():
    now = datetime.now(KYIV)
    keys = {now.strftime("%d.%m"), (now + timedelta(days=1)).strftime("%d.%m")}
    new = {d: qs for d, qs in fetch_schedules().items() if d in keys}  # только сегодня и завтра
    if not new:
        print("график на сегодня/завтра не найден")
        return
    old = load_state()
    if old is not None:
        subs = subscribers()
        for d, qs in new.items():
            for q, hours in qs.items():
                before = old.get(d, {}).get(q)
                if before == hours:
                    continue
                if d not in old:
                    notify(subs, q, f"💡 Очередь {q}: новый график на {d}\nОтключения: {hours}")
                elif before is None:
                    pass  # очередь раньше была неизвестна — молча запоминаем
                else:
                    notify(subs, q, f"⚠️ Очередь {q}: график на {d} изменён\nБыло: {before}\nСтало: {hours}")
    merged = {d: dict(qs) for d, qs in new.items()}
    for d, qs in (old or {}).items():  # неизвестное сегодня не затираем старым значением
        if d in merged:
            for q, h in qs.items():
                merged[d].setdefault(q, h)
    if old is None and CHAT:
        lines = [f"{d}: {new[d].get(DEFAULT_QUEUE, '—')}" for d in sorted(new)]
        tg_send(CHAT, f"✅ Бот запущен. Очередь {DEFAULT_QUEUE}, Запорожье.\n" + "\n".join(lines))
    save_state(merged)
    print(time.strftime("%H:%M:%S"), {d: qs.get(DEFAULT_QUEUE) for d, qs in new.items()})


def main():
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]+", TOKEN):
        sys.exit("TG_TOKEN выглядит неправильно: нужен настоящий токен вида 123456789:AA...")
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
