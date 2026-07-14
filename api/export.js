const iconv = require("iconv-lite");

const {
  EXPORT_FETCH_LIMIT,
  getEventByToken,
  getRoom,
  getRoomState,
  isInternalRoom,
  listEntries,
} = require("./_supabase");

const CSV_EXPORT_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function getExpectedPassword() {
  return process.env.RESET_PASSWORD || (!process.env.SUPABASE_URL ? "abcd" : "");
}

function normalizeTitle(value) {
  return String(value || "main")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 64) || "main";
}

function isExportExpired(event) {
  if (!event?.expiresAt) {
    return false;
  }

  const expiresAt = new Date(event.expiresAt).getTime();
  return Number.isFinite(expiresAt) && Date.now() > expiresAt + CSV_EXPORT_GRACE_MS;
}

function assertPassword(req, res) {
  const expected = getExpectedPassword();
  const submitted = String(req.body?.password || "");

  if (!expected) {
    res.status(500).json({ error: "RESET_PASSWORD is not configured." });
    return false;
  }

  if (!submitted || submitted !== expected) {
    res.status(403).json({ error: "Invalid admin password." });
    return false;
  }

  return true;
}

function escapeCsvCell(value) {
  const cell = String(value ?? "");
  if (!/[",\r\n]/.test(cell)) {
    return cell;
  }

  return `"${cell.replace(/"/g, '""')}"`;
}

function formatCsvTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function buildCsv(title, entries) {
  const rows = [["タイトル", "ワード", "時間"]];
  for (const entry of [...entries].reverse()) {
    rows.push([title, entry.word, formatCsvTime(entry.created_at)]);
  }

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n") + "\r\n";
}

function buildFilename(title) {
  const safeTitle = normalizeTitle(title).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `word-cloud-${safeTitle}-${timestamp}.csv`;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    const token = String(req.body?.token || "").trim();
    const event = token ? await getEventByToken(token) : null;
    if (token && !event) {
      res.status(403).json({ error: "Invalid admin URL." });
      return;
    }

    if (event && isExportExpired(event)) {
      res.status(403).json({ error: "CSV export period has expired." });
      return;
    }

    const room = event?.room || getRoom(req);
    if (!event && isInternalRoom(room)) {
      res.status(403).json({ error: "This room cannot be exported directly." });
      return;
    }

    if (!event && !assertPassword(req, res)) {
      return;
    }

    const state = await getRoomState(room);
    const entries = await listEntries(room, {
      since: state.resetAt,
      includeCreatedAt: true,
      limit: EXPORT_FETCH_LIMIT,
    });
    const title = normalizeTitle(state.title || event?.title || room);
    const csv = buildCsv(title, entries);
    const csvBuffer = iconv.encode(csv, "Shift_JIS");
    const filename = buildFilename(title);

    res.setHeader("Content-Type", "text/csv; charset=Shift_JIS");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("X-CSV-Export-Expires-At", event?.expiresAt || "");
    res.status(200).send(csvBuffer);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: "CSV export failed.",
      detail: error.message,
    });
  }
};
