// Telegram webhook: каждый человек выбирает свою очередь и смотрит график кнопками.
const { QUEUES, schedules, dayKey, postTime } = require("../lib/schedule");
const { loadSubs, saveSubs } = require("../lib/subs");

const KEYBOARD = {
  keyboard: [[{ text: "📅 Сегодня" }, { text: "📅 Завтра" }], [{ text: "🔄 Обновить" }, { text: "⚙️ Сменить очередь" }]],
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
  const lines = days.map((o) => {
    const k = dayKey(o);
    const v = data[k] && data[k][q];
    return `${names[o]} ${k}: ${v ? `${v.hours} (пост в ${postTime(v.at)})` : "график ещё не опубликован"}`;
  });
  return send(chat, `${prefix}⚡ Очередь ${q}, Запорожье\n${lines.join("\n")}`, KEYBOARD);
}

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
            subs[chat] = { q: m[1] };
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
