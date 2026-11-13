// Данные бота в приватном Vercel Blob: подписчики {chat_id: {qs: ["4.2"], mute?: true}} и отметки напоминаний.
async function blob() {
  return import("@vercel/blob");
}

async function loadJson(name, fallback) {
  const { get } = await blob();
  const r = await get(name, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return fallback;
  return JSON.parse(await new Response(r.stream).text());
}

async function saveJson(name, data) {
  const { put } = await blob();
  await put(name, JSON.stringify(data), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

async function loadSubs() {
  // файла ещё нет: первым подписчиком считаем владельца (очередь 4.2)
  const seed = process.env.TG_CHAT_ID ? { [process.env.TG_CHAT_ID]: { qs: ["4.2"] } } : {};
  const subs = await loadJson("subs.json", seed);
  for (const v of Object.values(subs)) {  // старый формат {q: "4.2"} -> {qs: ["4.2"]}
    if (!v.qs) v.qs = v.q ? [v.q] : [];
    delete v.q;
  }
  return subs;
}

const saveSubs = (subs) => saveJson("subs.json", subs);

module.exports = { loadSubs, saveSubs, loadJson, saveJson };
