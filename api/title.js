const { clearRoom, getActiveRoom, setActiveRoom } = require("./_supabase");

function normalizeTitle(value) {
  return String(value || "main")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 64) || "main";
}

function getExpectedPassword() {
  return process.env.RESET_PASSWORD || (!process.env.SUPABASE_URL ? "local-reset" : "");
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const room = await getActiveRoom();
      res.status(200).json({ room });
      return;
    }

    if (req.method === "POST") {
      const expectedPassword = getExpectedPassword();
      const submittedPassword = String(req.body?.password || "");

      if (!expectedPassword) {
        res.status(500).json({ error: "RESET_PASSWORD is not configured." });
        return;
      }

      if (!submittedPassword || submittedPassword !== expectedPassword) {
        res.status(403).json({ error: "Invalid admin password." });
        return;
      }

      const room = normalizeTitle(req.body?.room);
      await clearRoom(room);
      await setActiveRoom(room);
      res.status(200).json({ ok: true, room });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: "Title request failed.",
      detail: error.message,
    });
  }
};
