const { getRoom, getRoomState, setRoomState } = require("./_supabase");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    const room = getRoom(req);
    const expectedPassword = process.env.RESET_PASSWORD || (!process.env.SUPABASE_URL ? "XXX" : "");
    const submittedPassword = String(req.body?.password || "");

    if (!expectedPassword) {
      res.status(500).json({ error: "RESET_PASSWORD is not configured." });
      return;
    }

    if (!submittedPassword || submittedPassword !== expectedPassword) {
      res.status(403).json({ error: "Invalid reset password." });
      return;
    }

    const current = await getRoomState(room);
    await setRoomState({
      room,
      title: current.title || room,
      mode: current.mode,
      accepting: current.accepting !== false,
      resetAt: new Date().toISOString(),
    });
    res.status(200).json({ ok: true, room });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: "Reset failed.",
      detail: error.message,
    });
  }
};
