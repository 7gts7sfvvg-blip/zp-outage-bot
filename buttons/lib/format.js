// Работа со строками графика «00:00 – 01:00, 05:30 – 10:30» и текущим временем в Киеве.
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

module.exports = { spans, totalMin, hhmm, dur, nowMin, status };
