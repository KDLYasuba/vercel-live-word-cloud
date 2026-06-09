const {
  aggregateEntries,
  getRoom,
  insertEntry,
  listEntries,
} = require("./_supabase");

module.exports = async (req, res) => {
  try {
    const room = getRoom(req);

    if (req.method === "GET") {
      const entries = await listEntries(room);
      res.status(200).json({
        room,
        words: aggregateEntries(entries),
      });
      return;
    }

    if (req.method === "POST") {
      const normalized = String(req.body?.word || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 30);

      if (!normalized) {
        res.status(400).json({ error: "Word is required." });
        return;
      }

      await insertEntry(room, normalized);
      const entries = await listEntries(room);
      res.status(200).json({
        ok: true,
        room,
        words: aggregateEntries(entries),
      });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: "Request failed.",
      detail: error.message,
    });
  }
};
