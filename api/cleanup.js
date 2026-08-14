const { cleanupExpiredEventData } = require("./_supabase");

const CLEANUP_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function assertCronSecret(req, res) {
  const expected = process.env.CRON_SECRET || "";
  const authorization = String(req.headers.authorization || "");
  const submitted = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!expected) {
    res.status(500).json({ error: "CRON_SECRET is not configured." });
    return false;
  }

  if (submitted !== expected) {
    res.status(401).json({ error: "Unauthorized." });
    return false;
  }

  return true;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    if (!assertCronSecret(req, res)) {
      return;
    }

    const result = await cleanupExpiredEventData({
      graceMs: CLEANUP_GRACE_MS,
    });

    res.status(200).json({
      ok: true,
      graceDays: 3,
      checked: result.checked,
      cleanedCount: result.cleaned.length,
      cleaned: result.cleaned,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: "Cleanup failed.",
      detail: error.message,
    });
  }
};
