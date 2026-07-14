const {
  getActiveState,
  getEventByToken,
  getEventForRoom,
  getRoom,
  getRoomState,
  isEventExpired,
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
  return process.env.RESET_PASSWORD || (!process.env.SUPABASE_URL ? "XXX" : "");
}

async function getTokenEvent(req) {
  const token = String(req.query?.token || req.body?.token || "").trim();
  if (!token) {
    return null;
  }

  const event = await getEventByToken(token);
  if (!event) {
    const error = new Error("Invalid admin URL.");
    error.statusCode = 403;
    throw error;
  }

  return event;
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const tokenEvent = await getTokenEvent(req);
      const room = tokenEvent ? tokenEvent.room : req.query?.room ? getRoom(req) : "";
      const roomEvent = !tokenEvent && room ? await getEventForRoom(room) : null;
      const event = tokenEvent || roomEvent;
      const state = room ? await getRoomState(room) : await getActiveState();
      const expired = event ? isEventExpired(event) : false;
      res.status(200).json({
        ...state,
        room: event?.room || state.room,
        expiresAt: event?.expiresAt || null,
        expired,
        accepting: expired ? false : state.accepting,
      });
      return;
    }

    if (req.method === "POST") {
      const event = await getTokenEvent(req);
      if (event && isEventExpired(event)) {
        res.status(403).json({ error: "This admin URL has expired." });
        return;
      }

      const requestedRoom = event?.room || normalizeOptionalTitle(req.body?.room || req.query?.room || "");
      const current = requestedRoom ? await getRoomState(requestedRoom) : await getActiveState();
      const room = requestedRoom || normalizeTitle(current.room);
      const title = normalizeTitle(req.body?.title || req.body?.roomTitle || req.body?.room || current.title || room);
      const mode = normalizeMode(req.body?.mode || current.mode);
      const accepting =
        typeof req.body?.accepting === "boolean" ? req.body.accepting : current.accepting !== false;
      const shouldReset = req.body?.reset !== false;
      const resetAt = shouldReset ? new Date().toISOString() : current.resetAt || null;
      const requiresPassword =
        shouldReset || title !== (current.title || current.room) || accepting !== (current.accepting !== false);

      if (requiresPassword && !event) {
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

      const state =
        req.body?.scoped !== false || req.query?.room
          ? await setRoomState({ room, title, mode, accepting, resetAt })
          : await setActiveState({ room, title, mode, accepting, resetAt });
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
