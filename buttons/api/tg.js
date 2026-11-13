// Telegram webhook: выбор очередей (можно несколько), график и статус кнопками.
const { QUEUES, schedules, dayKey, postTime } = require("../lib/schedule");
const { loadSubs, saveSubs } = require("../lib/subs");
const { spans, totalMin, dur, status } = require("../lib/format");

const MAX_QUEUES = 4;

const KEYBOARD = {
  keyboard: [
    [{ text: "📅 Сегодня" }, { text: "📅 Завтра" }],
    [{ text: "🔄 Обновить" }, { text: "⚙️ Сменить очередь" }],
    [{ text: "🔔 Уведомления" }, { text: "ℹ️ Помощь" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const picker = (qs) => ({
  inline_keyboard: [
    ...[1, 2, 3, 4, 5, 6].map((a) => [1, 2].map((b) => {
      const q = `${a}.${b}`;
      return { text: `${qs.includes(q) ? "✅ " : ""}${q}`, callback_data: `t:${q}` };
    })),
    [{ text: "Готово", callback_data: "ok" }],
  ],
});

const PICK_TEXT = `Выберите очередь отключений (до ${MAX_QUEUES} штук, например дом и родители). Нажмите ещё раз, чтобы убрать. Свою очередь можно узнать на zoe.com.ua. Потом нажмите «Готово».`;

const HELP =
  "ℹ️ Как это работает\n" +
  "• Выберите очередь (можно несколько) — я напишу, когда график на сегодня или завтра появится или изменится.\n" +
  "• За 30 минут до отключения пришлю напоминание, а когда свет должен вернуться — сообщу.\n" +
  "• 📅 Сегодня / 📅 Завтра / 🔄 Обновить — график и «свет есть/нет» прямо сейчас.\n" +
  "• 🔔 Уведомления — включить или выключить сообщения.\n" +
  "• ⚙️ Сменить очередь — изменить выбор.\n" +
  "• /stop — полностью отписаться.\n\n" +
  "Данные берутся из публичных каналов Запоріжжяобленерго и могут отставать от сайта zoe.com.ua.";

async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

const send = (chat, text, markup) => api("sendMessage", { chat_id: chat, text, reply_markup: markup });

async function schedule(chat, qs, days, prefix = "") {
  let data;
  try {
    data = await schedules();
  } catch (e) {
    return send(chat, "Не удалось прочитать каналы, попробуйте через минуту.", KEYBOARD);
  }
  const names = ["Сегодня", "Завтра"];
  const blocks = qs.map((q) => {
    const get = (o) => data[dayKey(o)] && data[dayKey(o)][q];
    const lines = days.map((o) => {
      const v = get(o);
      if (!v) return `${names[o]} ${dayKey(o)}: график ещё не опубликован`;
      const total = totalMin(spans(v.hours));
      return `${names[o]} ${dayKey(o)}: ${v.hours}${total ? ` · всего ${dur(total)}` : ""} (пост в ${postTime(v.at)})`;
    });
    const st = days.includes(0) && get(0) ? `\n${status(spans(get(0).hours), get(1) ? spans(get(1).hours) : [])}` : "";
    return `⚡ Очередь ${q}, Запорожье\n${lines.join("\n")}${st}`;
  });
  return send(chat, prefix + blocks.join("\n\n"), KEYBOARD);
}

const askQueue = (chat, qs = []) => send(chat, PICK_TEXT, picker(qs));

module.exports = async (req, res) => {
  try {
    if (req.headers["x-telegram-bot-api-secret-token"] !== process.env.WEBHOOK_SECRET) return res.status(200).send("ok");
    const u = req.body || {};

    if (u.callback_query) {
      const cq = u.callback_query;
      const chat = cq.message && cq.message.chat && cq.message.chat.id;
      const toggle = /^[tq]:(\d\.\d)$/.exec(cq.data || "");
      if (chat && toggle && QUEUES.includes(toggle[1])) {
        const subs = await loadSubs();
        const cur = subs[chat] || { qs: [] };
        const q = toggle[1];
        if (cur.qs.includes(q)) cur.qs = cur.qs.filter((x) => x !== q);
        else if (cur.qs.length < MAX_QUEUES) cur.qs.push(q);
        else {
          await api("answerCallbackQuery", { callback_query_id: cq.id, text: `Не больше ${MAX_QUEUES} очередей`, show_alert: true });
          return res.status(200).send("ok");
        }
        cur.qs.sort();
        subs[chat] = cur;
        await Promise.all([
          api("answerCallbackQuery", { callback_query_id: cq.id }),
          api("editMessageReplyMarkup", { chat_id: chat, message_id: cq.message.message_id, reply_markup: picker(cur.qs) }),
          saveSubs(subs),
        ]);
      } else if (chat && cq.data === "ok") {
        const sub = (await loadSubs())[chat];
        if (!sub || !sub.qs.length) {
          await api("answerCallbackQuery", { callback_query_id: cq.id, text: "Выберите хотя бы одну очередь", show_alert: true });
        } else {
          await api("answerCallbackQuery", { callback_query_id: cq.id, text: "Сохранено" });
          await schedule(chat, sub.qs, [0, 1], `✅ Очереди: ${sub.qs.join(", ")}. Напишу, когда график изменится.\n\n`);
        }
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
      const sub = (await loadSubs())[chat];
      await askQueue(chat, sub ? sub.qs : []);
    } else if (/^\/help/.test(text) || text.includes("помощ")) {
      await send(chat, HELP, KEYBOARD);
    } else if (text.includes("уведомлен")) {
      const subs = await loadSubs();
      if (!subs[chat] || !subs[chat].qs.length) {
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
      await send(chat, "Вы отписались. Чтобы включить снова, нажмите /start.");
    } else {
      const sub = (await loadSubs())[chat];
      if (!sub || !sub.qs.length) await askQueue(chat);
      else await schedule(chat, sub.qs, text.includes("сегодня") ? [0] : text.includes("завтра") ? [1] : [0, 1]);
    }
  } catch (e) {
    console.error(e);
  }
  res.status(200).send("ok");
};
