const {
  getEventByToken,
  getRoom,
  getRoomState,
  isEventExpired,
  isInternalRoom,
  setRoomState,
} = require("./_supabase");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    const token = String(req.body?.token || req.query?.token || "").trim();
    const event = token ? await getEventByToken(token) : null;
    if (token && !event) {
      res.status(403).json({ error: "Invalid admin URL." });
      return;
    }

    if (event && isEventExpired(event)) {
      res.status(403).json({ error: "This admin URL has expired." });
      return;
    }

    const room = event?.room || getRoom(req);
    if (isInternalRoom(room)) {
      res.status(403).json({ error: "This room cannot be reset." });
      return;
    }

    const expectedPassword = process.env.RESET_PASSWORD || (!process.env.SUPABASE_URL ? "XXX" : "");
    const submittedPassword = String(req.body?.password || "");

    if (!event && !expectedPassword) {
      res.status(500).json({ error: "RESET_PASSWORD is not configured." });
      return;
    }

    if (!event && (!submittedPassword || submittedPassword !== expectedPassword)) {
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
