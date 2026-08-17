const fs = require("fs/promises");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "word_entries";
const LOCAL_STORE_PATH = path.join(process.cwd(), ".local-word-entries.json");
const STATE_ROOM = "__live_word_cloud_state__";
const ROOM_STATE_PREFIX = "__live_word_cloud_room_state__:";
const EVENT_PREFIX = "__live_word_cloud_event__:";
const EVENT_INDEX_ROOM = "__live_word_cloud_event_index__";
const ENTRY_FETCH_LIMIT = 2000;
const EXPORT_FETCH_LIMIT = 10000;

function getSupabaseBaseUrl() {
  const rawUrl = String(SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!rawUrl) {
    return "";
  }

  return /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
}

function isInternalRoom(room) {
  return String(room || "").startsWith("__live_word_cloud_");
}

function normalizeMode(value) {
  return value === "tokens" ? "tokens" : "raw";
}

function hasSupabaseEnv() {
  return Boolean(getSupabaseBaseUrl() && SUPABASE_SERVICE_ROLE_KEY);
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

async function listLocalEntries(room, options = {}) {
  const entries = await readLocalEntries();
  const sinceTime = options.since ? new Date(options.since).getTime() : null;
  const limit = Number(options.limit || ENTRY_FETCH_LIMIT);
  const includeCreatedAt = options.includeCreatedAt === true;
  return entries
    .filter((entry) => entry.room === room)
    .filter((entry) => !sinceTime || new Date(entry.created_at).getTime() > sinceTime)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
    .map((entry) => ({
      word: entry.word,
      ...(includeCreatedAt ? { created_at: entry.created_at } : {}),
    }));
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

async function deleteLocalEntriesByRoom(room) {
  const entries = await readLocalEntries();
  const keptEntries = entries.filter((entry) => entry.room !== room);
  await writeLocalEntries(keptEntries);
  return entries.length - keptEntries.length;
}

async function listLocalEntriesByRoom(room, options = {}) {
  const entries = await readLocalEntries();
  const limit = Number(options.limit || ENTRY_FETCH_LIMIT);
  return entries
    .filter((entry) => entry.room === room)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      room: entry.room,
      word: entry.word,
      created_at: entry.created_at,
    }));
}

async function deleteLocalEntriesByIds(ids) {
  const targetIds = new Set(ids.map((id) => String(id)));
  const entries = await readLocalEntries();
  const keptEntries = entries.filter((entry) => !targetIds.has(String(entry.id)));
  await writeLocalEntries(keptEntries);
  return entries.length - keptEntries.length;
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

  let response;
  try {
    response = await fetch(`${getSupabaseBaseUrl()}/rest/v1/${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    const nextError = new Error(
      "Supabaseに接続できません。VercelのSUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、Supabaseプロジェクトの起動状態を確認してください。",
    );
    nextError.statusCode = 502;
    throw nextError;
  }

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

async function listEntries(room, options = {}) {
  if (!hasSupabaseEnv()) {
    return listLocalEntries(room, options);
  }

  const filter = new URLSearchParams({
    select: options.includeCreatedAt === true ? "word,created_at" : "word",
    room: `eq.${room}`,
    order: "created_at.desc",
    limit: String(options.limit || ENTRY_FETCH_LIMIT),
  });
  if (options.since) {
    filter.set("created_at", `gt.${options.since}`);
  }

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

async function deleteEntriesByRoom(room) {
  if (!hasSupabaseEnv()) {
    return deleteLocalEntriesByRoom(room);
  }

  const filter = new URLSearchParams({
    room: `eq.${room}`,
  });
  const deleted = await supabaseFetch(`${SUPABASE_TABLE}?${filter.toString()}`, {
    method: "DELETE",
  });
  return Array.isArray(deleted) ? deleted.length : 0;
}

async function listEntriesByRoomWithIds(room, options = {}) {
  if (!hasSupabaseEnv()) {
    return listLocalEntriesByRoom(room, options);
  }

  const filter = new URLSearchParams({
    select: "id,room,word,created_at",
    room: `eq.${room}`,
    order: "created_at.desc",
    limit: String(options.limit || ENTRY_FETCH_LIMIT),
  });
  return supabaseFetch(`${SUPABASE_TABLE}?${filter.toString()}`, {
    method: "GET",
  });
}

async function deleteEntriesByIds(ids) {
  const normalizedIds = ids.map((id) => String(id)).filter(Boolean);
  if (!normalizedIds.length) {
    return 0;
  }

  if (!hasSupabaseEnv()) {
    return deleteLocalEntriesByIds(normalizedIds);
  }

  const filter = new URLSearchParams({
    id: `in.(${normalizedIds.join(",")})`,
  });
  const deleted = await supabaseFetch(`${SUPABASE_TABLE}?${filter.toString()}`, {
    method: "DELETE",
  });
  return Array.isArray(deleted) ? deleted.length : 0;
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function parseActiveState(value) {
  if (!value) {
    return { room: "main", title: "main", mode: "raw", accepting: true, resetAt: null };
  }

  try {
    const parsed = JSON.parse(value);
    const room = parsed.room || "main";
    return {
      room,
      title: parsed.title || room,
      mode: normalizeMode(parsed.mode),
      accepting: parsed.accepting !== false,
      resetAt: parsed.resetAt || null,
    };
  } catch (error) {
    return { room: value, title: value, mode: "raw", accepting: true, resetAt: null };
  }
}

function getEventKey(token) {
  return `${EVENT_PREFIX}${token}`;
}

function parseEvent(value, options = {}) {
  const parsed = safeParseJson(value);
  if (!parsed || !parsed.room || (options.requireToken && !parsed.token)) {
    return null;
  }

  return {
    token: parsed.token ? String(parsed.token) : "",
    room: String(parsed.room),
    title: String(parsed.title || parsed.room),
    expiresAt: parsed.expiresAt || null,
    createdAt: parsed.createdAt || null,
    deletedAt: parsed.deletedAt || null,
  };
}

function isEventExpired(event, now = new Date()) {
  if (!event?.expiresAt) {
    return false;
  }

  const expiresAt = new Date(event.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

async function getEventByToken(token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return null;
  }

  const entries = await listEntries(getEventKey(normalizedToken));
  const event = parseEvent(entries[0]?.word, { requireToken: true });
  return event?.deletedAt ? null : event;
}

async function setEvent(event) {
  const nextEvent = {
    token: event.token,
    room: event.room,
    title: event.title || event.room,
    expiresAt: event.expiresAt || null,
    createdAt: event.createdAt || new Date().toISOString(),
  };
  await insertEntry(getEventKey(nextEvent.token), JSON.stringify(nextEvent));
  await insertEntry(
    EVENT_INDEX_ROOM,
    JSON.stringify({
      room: nextEvent.room,
      title: nextEvent.title,
      expiresAt: nextEvent.expiresAt,
      createdAt: nextEvent.createdAt,
    }),
  );
  return nextEvent;
}

async function setEventDeleted(event) {
  const deletedEvent = {
    token: event.token,
    room: event.room,
    title: event.title || event.room,
    expiresAt: event.expiresAt || null,
    createdAt: event.createdAt || null,
    deletedAt: new Date().toISOString(),
  };
  await insertEntry(getEventKey(deletedEvent.token), JSON.stringify(deletedEvent));
  await insertEntry(
    EVENT_INDEX_ROOM,
    JSON.stringify({
      token: deletedEvent.token,
      room: deletedEvent.room,
      title: deletedEvent.title,
      expiresAt: deletedEvent.expiresAt,
      createdAt: deletedEvent.createdAt,
      deletedAt: deletedEvent.deletedAt,
    }),
  );
  return deletedEvent;
}

function latestEvents(entries, limit, options = {}) {
  const events = [];
  const seenTokens = new Set();
  const includeDeleted = options.includeDeleted === true;

  for (const entry of entries) {
    const event = parseEvent(entry.word, { requireToken: true });
    if (!event || seenTokens.has(event.token)) {
      continue;
    }

    seenTokens.add(event.token);
    if (includeDeleted || !event.deletedAt) {
      events.push(event);
    }

    if (events.length >= limit) {
      break;
    }
  }

  return events;
}

async function listEvents(options = {}) {
  const limit = Number(options.limit || 100);
  if (!hasSupabaseEnv()) {
    const entries = await readLocalEntries();
    const sortedEntries = entries
      .filter((entry) => String(entry.room || "").startsWith(EVENT_PREFIX))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return latestEvents(sortedEntries, limit, options);
  }

  const filter = new URLSearchParams({
    select: "word",
    room: `like.${EVENT_PREFIX}*`,
    order: "created_at.desc",
    limit: String(limit * 3),
  });
  const entries = await supabaseFetch(`${SUPABASE_TABLE}?${filter.toString()}`, {
    method: "GET",
  });

  return latestEvents(entries, limit, options);
}

async function getEventForRoom(room) {
  const entries = await listEntries(EVENT_INDEX_ROOM);
  for (const entry of entries) {
    const event = parseEvent(entry.word);
    if (event?.room === room) {
      return event;
    }
  }

  return null;
}

async function getActiveState() {
  const entries = await listEntries(STATE_ROOM);
  return parseActiveState(entries[0]?.word);
}

async function getActiveRoom() {
  const state = await getActiveState();
  return state.room;
}

async function setActiveState(state) {
  const room = state.room || "main";
  const nextState = {
    room,
    title: state.title || room,
    mode: normalizeMode(state.mode),
    accepting: state.accepting !== false,
    resetAt: state.resetAt || null,
  };
  await insertEntry(STATE_ROOM, JSON.stringify(nextState));
  return nextState;
}

function getRoomStateKey(room) {
  return `${ROOM_STATE_PREFIX}${room || "main"}`;
}

async function getRoomState(room) {
  const normalizedRoom = room || "main";
  const entries = await listEntries(getRoomStateKey(normalizedRoom));
  if (entries[0]?.word) {
    const state = parseActiveState(entries[0].word);
    return {
      room: normalizedRoom,
      title: state.title || normalizedRoom,
      mode: normalizeMode(state.mode),
      accepting: state.accepting !== false,
      resetAt: state.resetAt || null,
    };
  }

  const legacy = await getActiveState();
  if (legacy.room === normalizedRoom) {
    return {
      room: normalizedRoom,
      title: legacy.title || normalizedRoom,
      mode: normalizeMode(legacy.mode),
      accepting: legacy.accepting !== false,
      resetAt: legacy.resetAt || null,
    };
  }

  return {
    room: normalizedRoom,
    title: normalizedRoom,
    mode: "raw",
    accepting: true,
    resetAt: null,
  };
}

async function setRoomState(state) {
  const room = state.room || "main";
  const nextState = {
    room,
    title: state.title || room,
    mode: normalizeMode(state.mode),
    accepting: state.accepting !== false,
    resetAt: state.resetAt || null,
  };
  const stateKey = getRoomStateKey(room);
  await insertEntry(stateKey, JSON.stringify(nextState));
  return nextState;
}

function isEventPastCleanupGrace(event, now = new Date(), graceMs = 3 * 24 * 60 * 60 * 1000) {
  if (!event?.expiresAt) {
    return false;
  }

  const expiresAt = new Date(event.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt + graceMs <= now.getTime();
}

async function deleteEventData(event) {
  const indexEntries = await listEntriesByRoomWithIds(EVENT_INDEX_ROOM, { limit: EXPORT_FETCH_LIMIT });
  const eventIndexIds = indexEntries
    .filter((entry) => {
      const indexedEvent = parseEvent(entry.word);
      return indexedEvent?.room === event.room || indexedEvent?.token === event.token;
    })
    .map((entry) => entry.id);

  const deleted = {
    words: await deleteEntriesByRoom(event.room),
    roomState: await deleteEntriesByRoom(getRoomStateKey(event.room)),
    eventToken: event.token ? await deleteEntriesByRoom(getEventKey(event.token)) : 0,
    eventIndex: await deleteEntriesByIds(eventIndexIds),
  };

  return {
    room: event.room,
    title: event.title || event.room,
    expiresAt: event.expiresAt,
    deleted,
  };
}

async function cleanupExpiredEventData(options = {}) {
  const now = options.now || new Date();
  const graceMs = Number(options.graceMs || 3 * 24 * 60 * 60 * 1000);
  const events = await listEvents({
    includeDeleted: true,
    limit: Number(options.limit || EXPORT_FETCH_LIMIT),
  });
  const targets = events.filter((event) => isEventPastCleanupGrace(event, now, graceMs));
  const cleaned = [];

  for (const event of targets) {
    cleaned.push(await deleteEventData(event));
  }

  return {
    checked: events.length,
    cleaned,
  };
}

async function setActiveRoom(room) {
  const current = await getActiveState();
  const state = await setActiveState({ room, mode: current.mode });
  return state.room;
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
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 64);

  return room || "main";
}

module.exports = {
  aggregateEntries,
  getActiveState,
  getActiveRoom,
  getEventByToken,
  getEventForRoom,
  listEvents,
  getRoom,
  getRoomState,
  cleanupExpiredEventData,
  insertEntry,
  isInternalRoom,
  isEventExpired,
  listEntries,
  EXPORT_FETCH_LIMIT,
  normalizeMode,
  setActiveState,
  setActiveRoom,
  setEvent,
  setEventDeleted,
  setRoomState,
};
