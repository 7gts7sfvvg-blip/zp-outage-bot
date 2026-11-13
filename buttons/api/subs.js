// Список подписчиков для GitHub-бота (защищён секретом).
const { loadSubs } = require("../lib/subs");

module.exports = async (req, res) => {
  if (!process.env.SUBS_SECRET || req.headers["x-subs-secret"] !== process.env.SUBS_SECRET) {
    return res.status(404).send("not found");
  }
  try {
    res.status(200).json(await loadSubs());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
