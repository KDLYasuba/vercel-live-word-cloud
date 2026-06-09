module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    const expectedPassword = process.env.RESET_PASSWORD || (!process.env.SUPABASE_URL ? "local-reset" : "");
    const submittedPassword = String(req.body?.password || "");

    if (!expectedPassword) {
      res.status(500).json({ error: "RESET_PASSWORD is not configured." });
      return;
    }

    if (!submittedPassword || submittedPassword !== expectedPassword) {
      res.status(403).json({ error: "Invalid admin password." });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: "Authorization failed.",
      detail: error.message,
    });
  }
};
