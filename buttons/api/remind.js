// Напоминания: за 30 минут до отключения и «свет должен вернуться». Вызывается внешним таймером раз в минуту.
const { schedules, dayKey } = require("../lib/schedule");
const { loadSubs, loadJson, saveJson } = require("../lib/subs");
const { spans, hhmm, dur, nowMin } = require("../lib/format");

const BEFORE = 30; // за сколько минут предупреждать
const RETURN_WINDOW = 10; // сколько минут после конца отключения ещё сообщаем «свет вернулся»

async function tgSend(chat, text) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });
  return r.ok;
}

module.exports = async (req, res) => {
  const given = req.headers["x-subs-secret"] || (req.query && req.query.s);
  if (!process.env.REMIND_SECRET || given !== process.env.REMIND_SECRET) return res.status(404).send("not found");
  try {
    const [subs, data, sent] = await Promise.all([loadSubs(), schedules(), loadJson("reminded.json", {})]);
    const nm = nowMin();
    const now = Date.now();
    let count = 0;
    for (const k of Object.keys(sent)) if (now - sent[k] > 36 * 3600 * 1000) delete sent[k];

    for (const [chat, v] of Object.entries(subs)) {
      if (v.mute) continue;
      for (const q of v.qs) {
        const today = data[dayKey(0)] && data[dayKey(0)][q] ? spans(data[dayKey(0)][q].hours) : [];
        const tomorrow = data[dayKey(1)] && data[dayKey(1)][q] ? spans(data[dayKey(1)][q].hours) : [];
        const lastEndToday = today.length ? today[today.length - 1][1] : 0;
        for (const [off, list] of [[0, today], [1, tomorrow]]) {
          for (const s of list) {
            const start = s[0] + 1440 * off, end = s[1] + 1440 * off;
            const day = dayKey(off);
            // отключение, продолжающее сегодняшнее через полночь, отдельно не анонсируем
            const continuation = off === 1 && s[0] === 0 && lastEndToday >= 1440;
            const toStart = start - nm;
            if (!continuation && toStart > 0 && toStart <= BEFORE) {
              const key = `${chat}|${day}|${q}|s|${s[0]}`;
              if (!sent[key]) {
                const ok = await tgSend(chat, `⏰ Очередь ${q}: через ${dur(toStart)} отключение света (${hhmm(s[0])} – ${hhmm(s[1])})`);
                sent[key] = now;
                if (ok) count++;
              }
            }
            // свет возвращается; если дальше без паузы идёт завтрашнее отключение — не сообщаем
            const goesOn = off === 0 && s[1] >= 1440 && tomorrow.length && tomorrow[0][0] === 0;
            const sinceEnd = nm - end;
            if (!goesOn && sinceEnd >= 0 && sinceEnd <= RETURN_WINDOW && off === 0) {
              const key = `${chat}|${day}|${q}|e|${s[1]}`;
              if (!sent[key]) {
                const ok = await tgSend(chat, `💡 Очередь ${q}: по графику свет должен включиться (${hhmm(s[1])}). Иногда это занимает до 30 минут.`);
                sent[key] = now;
                if (ok) count++;
              }
            }
          }
        }
      }
    }
    await saveJson("reminded.json", sent);
    res.status(200).json({ sent: count });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
