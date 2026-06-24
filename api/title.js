const {
  clearRoom,
  getActiveState,
  getRoom,
  getRoomState,
  normalizeMode,
  setActiveState,
  setRoomState,
} = require("./_supabase");

function normalizeTitle(value) {
  return String(value || "main")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 64) || "main";
}

function normalizeOptionalTitle(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 64);

  return normalized;
}

function getExpectedPassword() {
  return process.env.RESET_PASSWORD || (!process.env.SUPABASE_URL ? "local-reset" : "");
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const state = req.query?.room ? await getRoomState(getRoom(req)) : await getActiveState();
      res.status(200).json(state);
      return;
    }

    if (req.method === "POST") {
      const requestedRoom = normalizeOptionalTitle(req.body?.room || req.query?.room || "");
      const current = requestedRoom ? await getRoomState(requestedRoom) : await getActiveState();
      const room = requestedRoom || normalizeTitle(current.room);
      const title = normalizeTitle(req.body?.title || req.body?.roomTitle || req.body?.room || current.title || room);
      const mode = normalizeMode(req.body?.mode || current.mode);
      const accepting =
        typeof req.body?.accepting === "boolean" ? req.body.accepting : current.accepting !== false;
      const shouldReset = req.body?.reset !== false;
      const requiresPassword =
        shouldReset || title !== (current.title || current.room) || accepting !== (current.accepting !== false);

      if (requiresPassword) {
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
      }

      if (shouldReset) {
        await clearRoom(room);
      }

      const state =
        req.body?.scoped !== false || req.query?.room
          ? await setRoomState({ room, title, mode, accepting })
          : await setActiveState({ room, title, mode, accepting });
      res.status(200).json({ ok: true, ...state });
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
