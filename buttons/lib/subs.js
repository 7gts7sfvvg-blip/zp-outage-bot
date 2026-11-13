// Подписчики {chat_id: {q: "4.2"}} в приватном Vercel Blob.
async function blob() {
  return import("@vercel/blob");
}

async function loadSubs() {
  const { get } = await blob();
  const r = await get("subs.json", { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) {
    // файла ещё нет: первым подписчиком считаем владельца (очередь 4.2)
    return process.env.TG_CHAT_ID ? { [process.env.TG_CHAT_ID]: { q: "4.2" } } : {};
  }
  return JSON.parse(await new Response(r.stream).text());
}

async function saveSubs(subs) {
  const { put } = await blob();
  await put("subs.json", JSON.stringify(subs), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

module.exports = { loadSubs, saveSubs };
