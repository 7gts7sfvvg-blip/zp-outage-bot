// Telegram webhook: каждый человек выбирает свою очередь и смотрит график кнопками.
const { QUEUES, schedules, dayKey, postTime } = require("../lib/schedule");
const { loadSubs, saveSubs } = require("../lib/subs");

const KEYBOARD = {
  keyboard: [[{ text: "📅 Сегодня" }, { text: "📅 Завтра" }], [{ text: "🔄 Обновить" }, { text: "⚙️ Сменить очередь" }], [{ text: "🔔 Уведомления" }, { text: "ℹ️ Помощь" }]],
  resize_keyboard: true,
  is_persistent: true,
};

const PICKER = {
  inline_keyboard: [1, 2, 3, 4, 5, 6].map((a) => [1, 2].map((b) => ({ text: `${a}.${b}`, callback_data: `q:${a}.${b}` }))),
};

async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

const send = (chat, text, markup) => api("sendMessage", { chat_id: chat, text, reply_markup: markup });

async function schedule(chat, q, days, prefix = "") {
  let data;
  try {
    data = await schedules();
  } catch (e) {
    return send(chat, "Не удалось прочитать каналы, попробуйте через минуту.", KEYBOARD);
  }
  const names = ["Сегодня", "Завтра"];
  const get = (o) => data[dayKey(o)] && data[dayKey(o)][q];
  const lines = days.map((o) => {
    const v = get(o);
    if (!v) return `${names[o]} ${dayKey(o)}: график ещё не опубликован`;
    const total = totalMin(spans(v.hours));
    return `${names[o]} ${dayKey(o)}: ${v.hours}${total ? ` · всего ${dur(total)}` : ""} (пост в ${postTime(v.at)})`;
  });
  const st = days.includes(0) && get(0) ? `\n\n${status(spans(get(0).hours), get(1) ? spans(get(1).hours) : [])}` : "";
  return send(chat, `${prefix}⚡ Очередь ${q}, Запорожье\n${lines.join("\n")}${st}`, KEYBOARD);
}

// ---- «сейчас свет есть/нет» ----
const spans = (hours) =>
  [...hours.matchAll(/(\d{1,2}):(\d{2}) – (\d{1,2}):(\d{2})/g)].map((m) => [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
const totalMin = (ss) => ss.reduce((a, s) => a + (s[1] - s[0]), 0);
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
function dur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h} ч ${m} мин` : h ? `${h} ч` : `${m} мин`;
}
function nowMin() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return (+p.find((x) => x.type === "hour").value % 24) * 60 + +p.find((x) => x.type === "minute").value;
}
function status(today, tomorrow) {
  const nm = nowMin();
  const cur = today.find((s) => s[0] <= nm && nm < s[1]);
  if (cur) {
    let end = cur[1];
    if (end >= 1440 && tomorrow.length && tomorrow[0][0] === 0) end = 1440 + tomorrow[0][1];
    return `🔴 Света сейчас нет. Включат в ${hhmm(end)}${end >= 1440 ? " (завтра)" : ""} — через ${dur(end - nm)}`;
  }
  const next = today.find((s) => s[0] > nm);
  if (next) return `🟢 Свет есть. Следующее отключение в ${hhmm(next[0])} — через ${dur(next[0] - nm)}`;
  if (tomorrow.length) return `🟢 Сегодня больше отключений нет. Завтра первое в ${hhmm(tomorrow[0][0])}`;
  return "🟢 Сегодня больше отключений нет";
}

const HELP =
  "ℹ️ Как это работает\n" +
  "• Выберите очередь — я напишу, когда график на сегодня или завтра появится или изменится.\n" +
  "• 📅 Сегодня / 📅 Завтра / 🔄 Обновить — график прямо сейчас и «свет есть/нет».\n" +
  "• 🔔 Уведомления — включить или выключить сообщения об изменениях.\n" +
  "• ⚙️ Сменить очередь — выбрать другую.\n" +
  "• /stop — полностью отписаться.\n\n" +
  "Данные берутся из публичных каналов Запоріжжяобленерго и могут отставать от сайта zoe.com.ua.";

const askQueue = (chat) => send(chat, "Выберите вашу очередь отключений (её можно узнать на сайте zoe.com.ua или в договоре):", PICKER);

module.exports = async (req, res) => {
  try {
    if (req.headers["x-telegram-bot-api-secret-token"] !== process.env.WEBHOOK_SECRET) return res.status(200).send("ok");
    const u = req.body || {};

    if (u.callback_query) {
      const cq = u.callback_query;
      const chat = cq.message && cq.message.chat && cq.message.chat.id;
      const m = /^q:(\d\.\d)$/.exec(cq.data || "");
      if (chat && m && QUEUES.includes(m[1])) {
        // сразу гасим «часики» на кнопке, остальное делаем параллельно
        await api("answerCallbackQuery", { callback_query_id: cq.id, text: `Очередь ${m[1]}` });
        const save = (async () => {
          const subs = await loadSubs();
          if (Object.keys(subs).length < 5000) {
            subs[chat] = { ...subs[chat], q: m[1] };
            await saveSubs(subs);
          }
        })();
        await Promise.all([
          save,
          schedule(chat, m[1], [0, 1], `✅ Очередь ${m[1]} сохранена. Напишу, когда график изменится.\n\n`),
        ]);
      } else {
        await api("answerCallbackQuery", { callback_query_id: cq.id });
      }
      return res.status(200).send("ok");
    }

    const msg = u.message;
    if (!msg || !msg.text || msg.chat.type !== "private") return res.status(200).send("ok");
    const chat = msg.chat.id;
    const text = msg.text.toLowerCase();

    if (/^\/(start|queue|change)/.test(text) || text.includes("сменить")) {
      await askQueue(chat);
    } else if (/^\/help/.test(text) || text.includes("помощ")) {
      await send(chat, HELP, KEYBOARD);
    } else if (text.includes("уведомлен")) {
      const subs = await loadSubs();
      if (!subs[chat]) {
        await askQueue(chat);
      } else {
        subs[chat].mute = !subs[chat].mute;
        await saveSubs(subs);
        await send(chat, subs[chat].mute ? "🔕 Уведомления выключены. Кнопки продолжают работать." : "🔔 Уведомления включены.", KEYBOARD);
      }
    } else if (/^\/stop/.test(text)) {
      const subs = await loadSubs();
      delete subs[chat];
      await saveSubs(subs);
      await send(chat, "Уведомления отключены. Чтобы включить снова, нажмите /start.");
    } else {
      const sub = (await loadSubs())[chat];
      if (!sub) await askQueue(chat);
      else await schedule(chat, sub.q, text.includes("сегодня") ? [0] : text.includes("завтра") ? [1] : [0, 1]);
    }
  } catch (e) {
    console.error(e);
  }
  res.status(200).send("ok");
};
