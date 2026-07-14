const crypto = require("crypto");

const {
  getEventByToken,
  isEventExpired,
  normalizeMode,
  setEvent,
  setRoomState,
} = require("./_supabase");

const ISSUER_RATE_LIMIT_WINDOW_MS = Number(process.env.ISSUER_RATE_LIMIT_WINDOW_MS || 60000);
const ISSUER_RATE_LIMIT_PER_IP = Number(process.env.ISSUER_RATE_LIMIT_PER_IP || 10);
const issuerBuckets = new Map();

function normalizeText(value, fallback = "") {
  return String(value || fallback)
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 64);
}

function getClientIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "");
  return forwarded.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function checkIssuerRateLimit(req) {
  const now = Date.now();
  const key = getClientIp(req);
  const current = issuerBuckets.get(key);
  if (!current || current.resetAt <= now) {
    issuerBuckets.set(key, { count: 1, resetAt: now + ISSUER_RATE_LIMIT_WINDOW_MS });
    return true;
  }

  current.count += 1;
  return current.count <= ISSUER_RATE_LIMIT_PER_IP;
}

function getIssuerPassword() {
  return process.env.ISSUER_PASSWORD || process.env.RESET_PASSWORD || (!process.env.SUPABASE_URL ? "XXX" : "");
}

function assertIssuerPassword(req, res) {
  const expected = getIssuerPassword();
  const submitted = String(req.body?.password || req.query?.password || "");

  if (!expected) {
    res.status(500).json({ error: "ISSUER_PASSWORD is not configured." });
    return false;
  }

  if (!submitted || submitted !== expected) {
    res.status(403).json({ error: "Invalid issuer password." });
    return false;
  }

  return true;
}

function buildUrls(req, event) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || "http";
  const origin = host ? `${proto}://${host}` : "";
  const adminUrl = `${origin}/admin?token=${encodeURIComponent(event.token)}`;
  const participantUrl = `${origin}/?room=${encodeURIComponent(event.room)}`;
  const screenUrl = `${origin}/screen?room=${encodeURIComponent(event.room)}`;

  return { adminUrl, participantUrl, screenUrl };
}

async function createToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = crypto.randomBytes(18).toString("base64url");
    const existing = await getEventByToken(token);
    if (!existing) {
      return token;
    }
  }

  throw new Error("Could not create a unique token.");
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const token = String(req.query?.token || "").trim();
      const event = await getEventByToken(token);
      if (!event) {
        res.status(404).json({ error: "Event not found." });
        return;
      }

      res.status(200).json({
        ...event,
        expired: isEventExpired(event),
        ...buildUrls(req, event),
      });
      return;
    }

    if (req.method === "POST") {
      if (!checkIssuerRateLimit(req)) {
        res.status(429).json({ error: "Too many attempts. Please wait and try again." });
        return;
      }

      if (!assertIssuerPassword(req, res)) {
        return;
      }

      const title = normalizeText(req.body?.title, "新しいイベント") || "新しいイベント";
      const expiresAt = String(req.body?.expiresAt || "").trim();
      const expiresTime = new Date(expiresAt).getTime();
      if (!expiresAt || !Number.isFinite(expiresTime)) {
        res.status(400).json({ error: "A valid expiresAt is required." });
        return;
      }

      if (expiresTime <= Date.now()) {
        res.status(400).json({ error: "expiresAt must be in the future." });
        return;
      }

      const token = await createToken();
      const room = `event_${token.slice(0, 12)}`;
      const event = await setEvent({
        token,
        room,
        title,
        expiresAt: new Date(expiresTime).toISOString(),
        createdAt: new Date().toISOString(),
      });

      await setRoomState({
        room,
        title,
        mode: normalizeMode(req.body?.mode),
        accepting: true,
        resetAt: null,
      });

      res.status(201).json({
        ok: true,
        ...event,
        expired: false,
        ...buildUrls(req, event),
      });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: "Event request failed.",
      detail: error.message,
    });
  }
};
