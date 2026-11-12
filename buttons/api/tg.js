// Telegram webhook: кнопки «Сегодня / Завтра / Обновить» с актуальным графиком очереди.
const QUEUE = process.env.QUEUE || "4.2";
const CHANNEL = process.env.CHANNEL || "Zaporizhzhyaoblenergo_news";
const TZ = "Europe/Kyiv";
const MONTHS = "січня лютого березня квітня травня червня липня серпня вересня жовтня листопада грудня".split(" ");

const KEYBOARD = {
  keyboard: [[{ text: "📅 Сегодня" }, { text: "📅 Завтра" }], [{ text: "🔄 Обновить" }]],
  resize_keyboard: true,
  is_persistent: true,
};

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function postDate(text) {
  let m = text.match(/(\d{1,2})\.(\d{2})\.\d{4}/);
  if (m) return `${m[1].padStart(2, "0")}.${m[2]}`;
  m = text.match(new RegExp(`(\\d{1,2})\\s+(${MONTHS.join("|")})`, "i"));
  if (m) return `${m[1].padStart(2, "0")}.${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}`;
  return null;
}

async function schedules() {
  const r = await fetch(`https://t.me/s/${CHANNEL}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  const page = await r.text();
  const out = {};
  for (const chunk of page.split('data-post="').slice(1)) {
    const m = chunk.match(/class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    if (!m) continue;
    const text = decode(m[1].replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, ""));
    if (!/Черга\s+\d\.\d/.test(text)) continue;
    const date = postDate(text);
    if (!date) continue;
    const t = chunk.match(/datetime="([^"]+)"/);
    const q = text.match(new RegExp(`Черга\\s+${QUEUE.replace(".", "\\.")}(?!\\d)([\\s\\S]*?)(?=Черга\\s+\\d|$)`));
    let hours = "отключений нет";
    if (q) {
      const spans = [...q[1].matchAll(/(\d{1,2}:\d{2})\s*(?:до|[–-])\s*(\d{1,2}:\d{2})/g)];
      if (spans.length) hours = spans.map((s) => `${s[1]} – ${s[2]}`).join(", ");
    }
    out[date] = { hours, at: t ? t[1] : null };
  }
  return out;
}

function dayKey(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit" }).formatToParts(d);
  return `${parts.find((p) => p.type === "day").value}.${parts.find((p) => p.type === "month").value}`;
}

function when(iso) {
  if (!iso) return "";
  return " (пост в " + new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) + ")";
}

async function reply(chat, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, reply_markup: KEYBOARD }),
  });
}

module.exports = async (req, res) => {
  try {
    const msg = req.body && req.body.message;
    if (
      req.headers["x-telegram-bot-api-secret-token"] !== process.env.WEBHOOK_SECRET ||
      !msg ||
      String(msg.chat.id) !== String(process.env.TG_CHAT_ID)
    ) {
      return res.status(200).send("ok");
    }
    const text = (msg.text || "").toLowerCase();
    const days = text.includes("сегодня") ? [0] : text.includes("завтра") ? [1] : [0, 1];
    let data;
    try {
      data = await schedules();
    } catch (e) {
      await reply(msg.chat.id, "Не удалось прочитать канал, попробуйте через минуту.");
      return res.status(200).send("ok");
    }
    const names = ["Сегодня", "Завтра"];
    const lines = days.map((o) => {
      const k = dayKey(o);
      const v = data[k];
      return `${names[o]} ${k}: ${v ? v.hours + when(v.at) : "график ещё не опубликован"}`;
    });
    await reply(msg.chat.id, `⚡ Очередь ${QUEUE}, Запорожье\n` + lines.join("\n"));
  } catch (e) {
    console.error(e);
  }
  res.status(200).send("ok");
};
