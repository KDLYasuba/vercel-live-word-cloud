const fs = require("fs/promises");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "word_entries";
const LOCAL_STORE_PATH = path.join(process.cwd(), ".local-word-entries.json");

function hasSupabaseEnv() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function isLegacyJwtKey(value) {
  return typeof value === "string" && value.startsWith("eyJ");
}

function assertEnv() {
  if (!hasSupabaseEnv()) {
    const error = new Error("Missing Supabase environment variables.");
    error.statusCode = 500;
    throw error;
  }
}

async function readLocalEntries() {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeLocalEntries(entries) {
  await fs.writeFile(LOCAL_STORE_PATH, `${JSON.stringify(entries, null, 2)}\n`);
}

async function listLocalEntries(room) {
  const entries = await readLocalEntries();
  return entries
    .filter((entry) => entry.room === room)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 500)
    .map((entry) => ({ word: entry.word }));
}

async function insertLocalEntry(room, word) {
  const entries = await readLocalEntries();
  entries.push({
    id: Date.now(),
    room,
    word,
    created_at: new Date().toISOString(),
  });
  await writeLocalEntries(entries);
  return [{ room, word }];
}

async function clearLocalRoom(room) {
  const entries = await readLocalEntries();
  await writeLocalEntries(entries.filter((entry) => entry.room !== room));
  return null;
}

async function supabaseFetch(path, options = {}) {
  assertEnv();

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...(options.headers || {}),
  };

  if (isLegacyJwtKey(SUPABASE_SERVICE_ROLE_KEY)) {
    headers.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || "Supabase request failed");
    error.statusCode = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function listEntries(room) {
  if (!hasSupabaseEnv()) {
    return listLocalEntries(room);
  }

  const filter = new URLSearchParams({
    select: "word",
    room: `eq.${room}`,
    order: "created_at.desc",
    limit: "500",
  });

  return supabaseFetch(`${SUPABASE_TABLE}?${filter.toString()}`, {
    method: "GET",
  });
}

async function insertEntry(room, word) {
  if (!hasSupabaseEnv()) {
    return insertLocalEntry(room, word);
  }

  return supabaseFetch(SUPABASE_TABLE, {
    method: "POST",
    body: JSON.stringify([{ room, word }]),
  });
}

async function clearRoom(room) {
  if (!hasSupabaseEnv()) {
    return clearLocalRoom(room);
  }

  const filter = new URLSearchParams({
    room: `eq.${room}`,
  });

  return supabaseFetch(`${SUPABASE_TABLE}?${filter.toString()}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });
}

function aggregateEntries(entries) {
  const counts = new Map();

  for (const entry of entries) {
    const current = counts.get(entry.word) || 0;
    counts.set(entry.word, current + 1);
  }

  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "ja"));
}

function getRoom(req) {
  const room = String(req.query.room || "main")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);

  return room || "main";
}

module.exports = {
  aggregateEntries,
  clearRoom,
  getRoom,
  insertEntry,
  listEntries,
};
