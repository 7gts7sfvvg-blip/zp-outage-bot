// Чтение графика отключений из публичных Telegram-каналов (порт parse_queues из bot.py).
const QUEUES = [];
for (let a = 1; a <= 6; a++) for (const b of [1, 2]) QUEUES.push(`${a}.${b}`);
const CHANNELS = (process.env.CHANNEL || "Zaporizhzhyaoblenergo_news,ProZaporizhzhia").split(",").map((s) => s.trim()).filter(Boolean);
const TZ = "Europe/Kyiv";
const MONTHS = "січня лютого березня квітня травня червня липня серпня вересня жовтня листопада грудня".split(" ");
const SPAN = "(\\d{1,2}:\\d{2})\\s*(?:до|[–-])\\s*(\\d{1,2}:\\d{2})";
const SPAN_NC = "\\d{1,2}:\\d{2}\\s*(?:до|[–-])\\s*\\d{1,2}:\\d{2}";

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function ddmm(date) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit" }).formatToParts(date);
  return `${p.find((x) => x.type === "day").value}.${p.find((x) => x.type === "month").value}`;
}

function dayKey(offset) {
  return ddmm(new Date(Date.now() + offset * 86400000));
}

function postDate(text) {
  let m = text.match(/(\d{1,2})\.(\d{2})\.\d{4}/);
  if (m) return `${m[1].padStart(2, "0")}.${m[2]}`;
  m = text.match(new RegExp(`(\\d{1,2})\\s+(${MONTHS.join("|")})`, "i"));
  if (m) return `${m[1].padStart(2, "0")}.${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}`;
  return null;
}

function postDay(posted, text) {
  const d = postDate(text);
  if (d) return d;
  const low = text.toLowerCase();
  if (low.includes("завтра")) return ddmm(new Date(posted.getTime() + 86400000));
  if (low.includes("сьогодні") || low.includes("сегодня")) return ddmm(posted);
  return null;
}

function parseQueues(text) {
  const found = {};
  if (/Черга\s+\d\.\d/.test(text)) {
    for (const m of text.matchAll(/Черга\s+(\d\.\d)([\s\S]*?)(?=Черга\s+\d\.\d|$)/g)) {
      const spans = [];
      for (const line of m[2].trim().split("\n")) {
        const mm = line.match(new RegExp(`^\\s*з\\s*${SPAN}\\s*\\.?\\s*$`));
        if (!mm) break;
        spans.push([mm[1], mm[2]]);
      }
      found[m[1]] = spans;
    }
  } else {
    const re = new RegExp(`(?<![\\d.:])(\\d\\.\\d):((?:\\s*${SPAN_NC}\\s*,?)*)`, "g");
    for (const m of text.matchAll(re)) {
      found[m[1]] = [...m[2].matchAll(new RegExp(SPAN, "g"))].map((x) => [x[1], x[2]]);
    }
  }
  if (!Object.keys(found).length) return {};
  const complete = "6.2" in found || /(?<![\d.])6\.2/.test(text);
  const out = {};
  for (const q of QUEUES) {
    if (found[q] && found[q].length) out[q] = found[q].map((s) => `${s[0]} – ${s[1]}`).join(", ");
    else if (q in found || complete) out[q] = "отключений нет";
  }
  return out;
}

async function channelPosts(ch) {
  const r = await fetch(`https://t.me/s/${ch}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  const page = await r.text();
  const posts = [];
  for (const chunk of page.split('data-post="').slice(1)) {
    const m = chunk.match(/class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    const t = chunk.match(/datetime="([^"]+)"/);
    if (!m || !t) continue;
    posts.push({ at: new Date(t[1]), text: decode(m[1].replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")) });
  }
  return posts;
}

const SNAPSHOT_URL = process.env.SNAPSHOT_URL || "https://raw.githubusercontent.com/7gts7sfvvg-blip/zp-outage-bot/site-data/site.json";

// Снимок сайта от устройства в Украине (feeder): {at, data: {дата: {очередь: часы}}}
async function siteSnapshot() {
  try {
    const r = await fetch(`${SNAPSHOT_URL}?t=${Math.floor(Date.now() / 60000)}`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

// {дата: {очередь: {hours, at}}} — для каждой пары самый свежий источник: посты каналов или снимок сайта
async function schedules() {
  const [snap, ...lists] = await Promise.all([siteSnapshot(), ...CHANNELS.map((c) => channelPosts(c).catch(() => []))]);
  const out = {};
  if (snap && snap.data) {
    const at = new Date(snap.at);
    for (const [day, qs] of Object.entries(snap.data)) {
      for (const [q, hours] of Object.entries(qs)) (out[day] = out[day] || {})[q] = { hours, at };
    }
  }
  for (const p of lists.flat()) {
    const parsed = parseQueues(p.text);
    if (!Object.keys(parsed).length) continue;
    const day = postDay(p.at, p.text);
    if (!day) continue;
    for (const [q, hours] of Object.entries(parsed)) {
      out[day] = out[day] || {};
      if (!out[day][q] || p.at > out[day][q].at) out[day][q] = { hours, at: p.at };
    }
  }
  return out;
}

function postTime(at) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(at);
}

module.exports = { QUEUES, schedules, dayKey, postTime };
