const cloud = document.getElementById("cloud");
const statusEl = document.getElementById("status");
const totalCountEl = document.getElementById("total-count");
const uniqueCountEl = document.getElementById("unique-count");
const currentRoomEl = document.getElementById("current-room");
const participantRoomTitleEl = document.getElementById("participant-room-title");
const roomForm = document.getElementById("room-form");
const roomInput = document.getElementById("room-input");
const form = document.getElementById("word-form");
const input = document.getElementById("word-input");
const submitButton = form?.querySelector('button[type="submit"]');
const acceptanceNotice = document.getElementById("acceptance-notice");
const screenLink = document.getElementById("screen-link");
const participantLink = document.getElementById("participant-link");
const wordModeButton = document.getElementById("word-mode-button");
const rawModeButton = document.getElementById("raw-mode-button");
const acceptanceToggleButton = document.getElementById("acceptance-toggle-button");
const csvExportButton = document.getElementById("csv-export-button");
const participantQr = document.getElementById("participant-qr");
const participantQrCard = document.querySelector(".participant-qr-card");
const participantQrBackdrop = document.getElementById("participant-qr-backdrop");
const participantUrlEl = document.getElementById("participant-url");

const isScreenMode = window.location.pathname === "/screen";
const params = new URLSearchParams(window.location.search);
const adminToken = params.get("token") || "";
const activeRoomStorageKey = "vercel-live-word-cloud-active-room";
const wordUpdateStorageKey = "vercel-live-word-cloud-word-update";
const roomChannel = "BroadcastChannel" in window ? new BroadcastChannel("vercel-live-word-cloud-room") : null;
const activeRefreshMs = 6000;
const idleTimeoutMs = 120000;
const idleCheckMs = 60000;
const cachedState = parseCachedState(readCachedRoom());
const hasRoomParam = params.has("room");
const usesRoomScopedState = hasRoomParam || Boolean(roomForm) || isScreenMode;
let room = normalizeRoom(params.get("room") || cachedState.room || "main");
let displayTitle = normalizeRoom(hasRoomParam ? room : cachedState.title || room);
let displayMode = normalizeMode(cachedState.mode);
let isAccepting = cachedState.accepting !== false;
let refreshTimer = null;
let idleCheckTimer = null;
let titleRefreshTimer = null;
let lastWordsSignature = "";
let lastWordsChangedAt = Date.now();
let wordPositionContext = "";
let wordPositionCache = new Map();

function normalizeRoom(value) {
  return String(value || "main")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 64) || "main";
}

function readCachedRoom() {
  try {
    return window.localStorage.getItem(activeRoomStorageKey);
  } catch (error) {
    return "";
  }
}

function updateRoomUi() {
  if (currentRoomEl) {
    currentRoomEl.textContent = displayTitle;
  }

  if (participantRoomTitleEl) {
    participantRoomTitleEl.textContent = displayTitle;
  }

  if (roomInput) {
    roomInput.value = displayTitle;
  }

  if (screenLink) {
    screenLink.href = `/screen?room=${encodeURIComponent(room)}`;
  }

  if (participantLink) {
    participantLink.href = `/?room=${encodeURIComponent(room)}`;
  }

  if (wordModeButton) {
    wordModeButton.classList.toggle("is-active", displayMode === "tokens");
  }

  if (rawModeButton) {
    rawModeButton.classList.toggle("is-active", displayMode === "raw");
  }

  if (acceptanceToggleButton) {
    acceptanceToggleButton.textContent = isAccepting ? "受付を停止" : "受付を再開";
    acceptanceToggleButton.classList.toggle("is-active", !isAccepting);
  }

  if (input) {
    input.disabled = !isAccepting;
  }

  if (submitButton) {
    submitButton.disabled = !isAccepting;
  }

  if (acceptanceNotice) {
    acceptanceNotice.classList.toggle("is-hidden", isAccepting);
  }

  updateParticipantQr();
}

function getParticipantUrl() {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("room", room);
  return url.toString();
}

function updateParticipantQr() {
  if (!participantQr) {
    return;
  }

  const participantUrl = getParticipantUrl();
  if (participantUrlEl) {
    participantUrlEl.textContent = participantUrl.replace(/^https?:\/\//, "");
  }

  if (typeof qrcode !== "function") {
    participantQr.removeAttribute("src");
    participantQr.alt = "QRコードを生成できませんでした";
    return;
  }

  const qr = qrcode(0, "M");
  qr.addData(participantUrl);
  qr.make();
  participantQr.src = qr.createDataURL(5, 8);
}

function setParticipantQrExpanded(isExpanded) {
  if (!participantQrCard) {
    return;
  }

  participantQrCard.classList.toggle("is-expanded", isExpanded);
  if (participantQrBackdrop) {
    participantQrBackdrop.classList.toggle("is-visible", isExpanded);
  }
  participantQrCard.setAttribute(
    "aria-label",
    isExpanded ? "参加者用フォームのQRコードを右上に戻す" : "参加者用フォームのQRコードを拡大表示",
  );
}

function toggleParticipantQr() {
  if (!participantQrCard) {
    return;
  }

  setParticipantQrExpanded(!participantQrCard.classList.contains("is-expanded"));
}

function normalizeMode(value) {
  return value === "tokens" ? "tokens" : "raw";
}

function notifyStateChange(nextRoom, nextMode, nextTitle = displayTitle, nextAccepting = isAccepting) {
  const state = JSON.stringify({
    room: nextRoom,
    title: nextTitle,
    mode: normalizeMode(nextMode),
    accepting: nextAccepting !== false,
  });

  try {
    window.localStorage.setItem(activeRoomStorageKey, state);
  } catch (error) {
    // localStorage may be unavailable in some embedded browsers.
  }

  if (roomChannel) {
    roomChannel.postMessage({
      room: nextRoom,
      title: nextTitle,
      mode: normalizeMode(nextMode),
      accepting: nextAccepting !== false,
    });
  }
}

function notifyWordsChanged() {
  const payload = {
    room,
    mode: displayMode,
    updatedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(wordUpdateStorageKey, JSON.stringify(payload));
  } catch (error) {
    // localStorage may be unavailable in some embedded browsers.
  }

  if (roomChannel) {
    roomChannel.postMessage({ ...payload, wordsChanged: true });
  }
}

function parseCachedState(value) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return {
      room: parsed.room,
      title: parsed.title,
      mode: normalizeMode(parsed.mode),
      accepting: parsed.accepting !== false,
    };
  } catch (error) {
    return { room: value, title: value, mode: "raw", accepting: true };
  }
}

function applyIncomingState(nextRoom, nextMode, nextTitle, nextAccepting = true) {
  const normalized = normalizeRoom(nextRoom);
  const normalizedTitle = normalizeRoom(nextTitle || normalized);
  const normalizedMode = normalizeMode(nextMode);
  const normalizedAccepting = nextAccepting !== false;
  if (
    normalized === room &&
    normalizedMode === displayMode &&
    normalizedTitle === displayTitle &&
    normalizedAccepting === isAccepting
  ) {
    return;
  }

  room = normalized;
  displayTitle = normalizedTitle;
  displayMode = normalizedMode;
  isAccepting = normalizedAccepting;
  params.set("room", room);
  if (adminToken) {
    params.set("token", adminToken);
  }
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  updateRoomUi();
  fetchWords()
    .then(() => setStatus(isScreenMode ? "自動更新中" : "タイトルを切り替えました。"))
    .catch((error) => setStatus(error.message));
}

function getWordsSignature(words) {
  return JSON.stringify(words.map((item) => [item.word, item.count, item.createdAt || ""]));
}

function handleFetchedWords(words, options = {}) {
  const nextSignature = getWordsSignature(words);
  const isFirstLoad = !lastWordsSignature;
  const changed = nextSignature !== lastWordsSignature;

  if (changed) {
    lastWordsSignature = nextSignature;
    lastWordsChangedAt = Date.now();
  }

  if (changed || isFirstLoad || options.forceRender) {
    render(words);
  }

  return { changed, isFirstLoad };
}

async function fetchActiveRoom() {
  const titleUrl = adminToken
    ? `/api/title?token=${encodeURIComponent(adminToken)}`
    : usesRoomScopedState
      ? `/api/title?room=${encodeURIComponent(room)}`
      : "/api/title";
  const response = await fetch(titleUrl, {
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Title fetch failed");
  }

  return {
    room: normalizeRoom(payload.room),
    title: normalizeRoom(payload.title || payload.room),
    mode: normalizeMode(payload.mode),
    accepting: payload.accepting !== false,
  };
}

async function syncActiveRoom() {
  const activeState = await fetchActiveRoom();
  applyIncomingState(activeState.room, activeState.mode, activeState.title, activeState.accepting);
  return activeState;
}

function hashString(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return hash;
}

function seededUnit(seed, salt = "") {
  return (hashString(`${seed}:${salt}`) % 10000) / 10000;
}

function colorForWord(word) {
  const palette = [
    "#14314e",
    "#dd6d4a",
    "#256f67",
    "#95602f",
    "#99405d",
    "#3568a0",
    "#6c5b2b",
    "#0f766e",
    "#b45309",
    "#be185d",
    "#1d4ed8",
    "#047857",
    "#7c3aed",
    "#c2410c",
    "#0f4c81",
    "#a21caf",
    "#3f6212",
    "#c0262d",
    "#1f6feb",
    "#4d7c0f",
  ];

  return palette[hashString(word) % palette.length];
}

function sizeForCount(count) {
  if (displayMode === "raw") {
    return {
      size: isScreenMode ? 30 : 20,
      bucket: 0,
      maxBucket: 0,
    };
  }

  const levels = isScreenMode
    ? [15, 35, 55, 75, 95, 115, 135, 155]
    : [12, 18, 26, 36, 48, 62, 78, 96];
  const bucket = Math.min(levels.length - 1, Math.max(0, count - 1));
  return {
    size: levels[bucket],
    bucket,
    maxBucket: levels.length - 1,
  };
}

function estimateChipWidth(text, fontSize, maxWidth = Infinity) {
  const naturalWidth = Math.max(fontSize * 2.4, text.length * fontSize * 0.98);
  return Math.min(naturalWidth, maxWidth);
}

function estimateChipHeight(text, fontSize, maxWidth = Infinity) {
  if (!Number.isFinite(maxWidth)) {
    return fontSize * 1.9;
  }

  const charsPerLine = Math.max(1, Math.floor(maxWidth / (fontSize * 0.98)));
  const lines = Math.max(1, Math.ceil(String(text || "").length / charsPerLine));
  return fontSize * (lines === 1 ? 2.1 : 1.1 + lines * 1.65);
}

function intersects(a, b) {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

function buildCandidatePositions(baseX, baseY, width, height, marginX, marginY, seed = "") {
  const candidates = [{ x: baseX, y: baseY }];
  const radiusSteps = isScreenMode
    ? [28, 56, 88, 124, 164, 210, 260, 318, 382, 450, 520]
    : [18, 36, 58, 84, 114, 148, 186, 228];
  const angleSteps = isScreenMode ? 18 : 14;
  const angleOffset = seededUnit(seed, "candidate-angle") * Math.PI * 2;

  for (const radius of radiusSteps) {
    for (let i = 0; i < angleSteps; i += 1) {
      const angle = angleOffset + (Math.PI * 2 * i) / angleSteps;
      const x = Math.min(width - marginX, Math.max(marginX, baseX + Math.cos(angle) * radius));
      const y = Math.min(height - marginY, Math.max(marginY, baseY + Math.sin(angle) * radius));
      candidates.push({ x, y });
    }
  }

  return candidates;
}

function buildScatterBasePosition(seed, index, total, width, height) {
  const spread = Math.min(1, Math.max(0, (total - 3) / 10));
  const centerRadius = 0.12 + seededUnit(seed, "center-radius") * 0.34;
  const angle = seededUnit(seed, "angle") * Math.PI * 2;
  const centerX = width * 0.5 + Math.cos(angle) * width * 0.3 * centerRadius;
  const centerY = height * 0.5 + Math.sin(angle) * height * 0.28 * centerRadius;
  const cols = Math.max(3, Math.ceil(Math.sqrt(total * (width / Math.max(height, 1)))));
  const rows = Math.max(2, Math.ceil(total / cols));
  const cellIndex = hashString(`${seed}:cell`) % (cols * rows);
  const col = cellIndex % cols;
  const row = Math.floor(cellIndex / cols);
  const areaX = width * ((col + 0.18 + seededUnit(seed, "cell-x") * 0.64) / cols);
  const areaY = height * ((row + 0.2 + seededUnit(seed, "cell-y") * 0.6) / rows);

  return {
    x: centerX * (1 - spread) + areaX * spread,
    y: centerY * (1 - spread) + areaY * spread,
  };
}

function buildRankedBasePosition(index, total, width, height, seed = "") {
  if (index === 0) {
    const centerJitter = isScreenMode ? 26 : 16;
    return {
      x: width * 0.5 + (seededUnit(seed, "center-x") - 0.5) * centerJitter,
      y: height * 0.5 + (seededUnit(seed, "center-y") - 0.5) * centerJitter,
    };
  }

  const progress = Math.sqrt(index / Math.max(1, total - 1));
  const angle = index * 2.399963229728653 + seededUnit(seed, "rank-angle") * 1.7;
  const radiusX = width * (isScreenMode ? 0.42 : 0.38) * progress;
  const radiusY = height * (isScreenMode ? 0.36 : 0.32) * progress;
  const jitterX = (seededUnit(seed, "rank-x") - 0.5) * width * (isScreenMode ? 0.08 : 0.06);
  const jitterY = (seededUnit(seed, "rank-y") - 0.5) * height * (isScreenMode ? 0.08 : 0.06);

  return {
    x: width * 0.5 + Math.cos(angle) * radiusX + jitterX,
    y: height * 0.5 + Math.sin(angle) * radiusY + jitterY,
  };
}

function getWordPositionKey(item, index) {
  if (displayMode === "raw") {
    return `${displayMode}:${item.word}:${item.createdAt || index}`;
  }

  return `${displayMode}:${item.word}`;
}

function getWordPositionContext(width, height) {
  return `${room}:${displayMode}:${Math.round(width / 20)}:${Math.round(height / 20)}`;
}

function buildWordBox(x, y, width, height) {
  const paddingX = isScreenMode ? 30 : 18;
  const paddingY = isScreenMode ? 24 : 16;
  return {
    left: x - width / 2 - paddingX,
    right: x + width / 2 + paddingX,
    top: y - height / 2 - paddingY,
    bottom: y + height / 2 + paddingY,
  };
}

function clampWordPosition(position, marginX, marginY, width, height) {
  return {
    x: Math.min(width - marginX, Math.max(marginX, position.x)),
    y: Math.min(height - marginY, Math.max(marginY, position.y)),
  };
}

function findAvailablePosition(basePosition, renderItem, width, height, placedBoxes) {
  const safePosition = clampWordPosition(
    basePosition,
    renderItem.marginX,
    renderItem.marginY,
    width,
    height,
  );
  const candidates = buildCandidatePositions(
    safePosition.x,
    safePosition.y,
    width,
    height,
    renderItem.marginX,
    renderItem.marginY,
    renderItem.positionSeed,
  );

  for (const candidate of candidates) {
    const box = buildWordBox(candidate.x, candidate.y, renderItem.chipWidth, renderItem.chipHeight);
    if (!placedBoxes.some((placed) => intersects(box, placed))) {
      return { chosen: candidate, box };
    }
  }

  return {
    chosen: safePosition,
    box: buildWordBox(safePosition.x, safePosition.y, renderItem.chipWidth, renderItem.chipHeight),
  };
}

function render(words) {
  if (!cloud) {
    return;
  }

  cloud.innerHTML = "";

  const total = words.reduce((sum, item) => sum + item.count, 0);
  if (totalCountEl) {
    totalCountEl.textContent = String(total);
  }
  if (uniqueCountEl) {
    const uniqueCount =
      displayMode === "raw" ? new Set(words.map((item) => item.word)).size : words.length;
    uniqueCountEl.textContent = String(uniqueCount);
  }

  if (!words.length) {
    wordPositionCache.clear();
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "まだワードがありません。";
    empty.style.padding = "20px";
    cloud.appendChild(empty);
    return;
  }

  const columns = Math.max(2, Math.ceil(Math.sqrt(words.length)));
  const width = cloud.clientWidth || (isScreenMode ? 1400 : 800);
  const height = cloud.clientHeight || (isScreenMode ? 800 : 560);
  const maxChipWidth = Math.max(160, width / columns - 10);
  const nextPositionContext = getWordPositionContext(width, height);
  if (nextPositionContext !== wordPositionContext) {
    wordPositionCache = new Map();
    wordPositionContext = nextPositionContext;
  }

  const renderItems = words.map((item, index) => {
    const label = item.word;
    const sizeInfo = sizeForCount(item.count);
    const fontSize = sizeInfo.size;
    const chipWidth = estimateChipWidth(label, fontSize, maxChipWidth);
    const chipHeight = estimateChipHeight(label, fontSize, maxChipWidth);
    const marginX = chipWidth / 2 + 34;
    const marginY = chipHeight / 2 + 30;
    const positionKey = getWordPositionKey(item, index);

    return {
      item,
      index,
      label,
      positionKey,
      positionSeed: `${room}:${displayMode}:${positionKey}`,
      fontSize,
      chipWidth,
      chipHeight,
      marginX,
      marginY,
      chosen: null,
    };
  });

  const activePositionKeys = new Set(renderItems.map((item) => item.positionKey));
  for (const key of wordPositionCache.keys()) {
    if (!activePositionKeys.has(key)) {
      wordPositionCache.delete(key);
    }
  }

  const placedBoxes = [];

  for (const renderItem of renderItems) {
    const cached = wordPositionCache.get(renderItem.positionKey);
    if (!cached) {
      continue;
    }

    const chosen = clampWordPosition(cached, renderItem.marginX, renderItem.marginY, width, height);
    const box = buildWordBox(chosen.x, chosen.y, renderItem.chipWidth, renderItem.chipHeight);
    if (placedBoxes.some((placed) => intersects(box, placed))) {
      const relocated = findAvailablePosition(chosen, renderItem, width, height, placedBoxes);
      renderItem.chosen = relocated.chosen;
      wordPositionCache.set(renderItem.positionKey, relocated.chosen);
      placedBoxes.push(relocated.box);
      continue;
    }

    renderItem.chosen = chosen;
    wordPositionCache.set(renderItem.positionKey, chosen);
    placedBoxes.push(box);
  }

  for (const renderItem of renderItems) {
    if (renderItem.chosen) {
      continue;
    }

    const basePosition =
      displayMode === "tokens"
        ? buildRankedBasePosition(renderItem.index, words.length, width, height, renderItem.positionSeed)
        : buildScatterBasePosition(renderItem.positionSeed, renderItem.index, words.length, width, height);
    const { chosen, box } = findAvailablePosition(basePosition, renderItem, width, height, placedBoxes);
    placedBoxes.push(box);
    renderItem.chosen = chosen;
    wordPositionCache.set(renderItem.positionKey, chosen);
  }

  renderItems.forEach((renderItem) => {
    const { chosen, fontSize, label, positionSeed } = renderItem;
    const chip = document.createElement("span");
    chip.className = `word-chip ${displayMode === "raw" ? "raw-chip" : "token-chip"}`;
    chip.textContent = label;
    chip.style.left = `${chosen.x}px`;
    chip.style.top = `${chosen.y}px`;
    chip.style.fontSize = `${fontSize}px`;
    chip.style.maxWidth = `${maxChipWidth}px`;
    chip.style.background = "transparent";
    chip.style.color = colorForWord(label);
    chip.style.setProperty("--rotate", `${Math.round((seededUnit(positionSeed, "rotate") - 0.5) * 8)}deg`);
    cloud.appendChild(chip);
  });
}

async function fetchWords(options = {}) {
  const response = await fetch(`/api/words?room=${encodeURIComponent(room)}&mode=${encodeURIComponent(displayMode)}`, {
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Fetch failed");
  }

  const words = payload.words || [];
  const state = handleFetchedWords(words, options);
  return { payload, ...state };
}

async function submitWord(word) {
  const response = await fetch(`/api/words?room=${encodeURIComponent(room)}&mode=${encodeURIComponent(displayMode)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ word }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Submit failed");
  }

  handleFetchedWords(payload.words || [], { forceRender: true });
  notifyWordsChanged();
}

async function resetRoom(targetRoom, password) {
  const roomToReset = normalizeRoom(targetRoom);
  if (!password) {
    throw new Error("リセットをキャンセルしました。");
  }

  const response = await fetch(`/api/reset?room=${encodeURIComponent(roomToReset)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password, token: adminToken }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Reset failed");
  }

  render([]);
}

async function applyTitle(nextTitle, password) {
  const normalizedTitle = normalizeRoom(nextTitle);
  const response = await fetch("/api/title", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      room,
      title: normalizedTitle,
      mode: displayMode,
      accepting: isAccepting,
      password,
      token: adminToken,
      scoped: true,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Title apply failed");
  }

  render([]);
  displayTitle = normalizeRoom(payload.title || payload.room);
  displayMode = normalizeMode(payload.mode);
  isAccepting = payload.accepting !== false;
  return normalizeRoom(payload.room);
}

async function applyDisplayMode(nextMode) {
  const normalizedMode = normalizeMode(nextMode);
  const response = await fetch("/api/title", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      room,
      title: displayTitle,
      mode: normalizedMode,
      accepting: isAccepting,
      reset: false,
      token: adminToken,
      scoped: true,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Mode apply failed");
  }

  room = normalizeRoom(payload.room);
  displayTitle = normalizeRoom(payload.title || payload.room);
  displayMode = normalizeMode(payload.mode);
  isAccepting = payload.accepting !== false;
  updateRoomUi();
  notifyStateChange(room, displayMode, displayTitle, isAccepting);
  await fetchWords();
  setStatus(displayMode === "tokens" ? "Goワード表示に切り替えました。" : "原文表示に戻しました。");
}

async function applyAcceptance(nextAccepting) {
  const password = adminToken ? "" : requestAdminPassword(nextAccepting ? "受付再開" : "受付停止");
  const response = await fetch("/api/title", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      room,
      title: displayTitle,
      mode: displayMode,
      accepting: nextAccepting,
      password,
      token: adminToken,
      reset: false,
      scoped: true,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Acceptance update failed");
  }

  room = normalizeRoom(payload.room);
  displayTitle = normalizeRoom(payload.title || payload.room);
  displayMode = normalizeMode(payload.mode);
  isAccepting = payload.accepting !== false;
  updateRoomUi();
  notifyStateChange(room, displayMode, displayTitle, isAccepting);
  setStatus(isAccepting ? "参加受付を再開しました。" : "参加受付を停止しました。");
}

function requestAdminPassword(actionLabel) {
  const password = window.prompt(`${actionLabel}する管理者パスワードを入力してください。`);
  if (!password) {
    throw new Error(`${actionLabel}をキャンセルしました。`);
  }

  return password;
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function getCsvFilenameFromDisposition(disposition) {
  const fallback = `word-cloud-${new Date().toISOString().slice(0, 10)}.csv`;
  const filenameMatch = String(disposition || "").match(/filename="([^"]+)"/i);
  if (!filenameMatch) {
    return fallback;
  }

  try {
    return decodeURIComponent(filenameMatch[1]);
  } catch (error) {
    return filenameMatch[1] || fallback;
  }
}

async function exportCsv() {
  const password = adminToken ? "" : requestAdminPassword("CSVデータ出力");
  const response = await fetch(`/api/export?room=${encodeURIComponent(room)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      room,
      token: adminToken,
      password,
    }),
  });

  if (!response.ok) {
    let message = "CSV export failed";
    try {
      const payload = await response.json();
      message = payload.detail || payload.error || message;
    } catch (error) {
      message = await response.text();
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const filename = getCsvFilenameFromDisposition(response.headers.get("Content-Disposition"));
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(downloadUrl);
  setStatus("CSVデータを出力しました。");
}

function startAutoRefresh() {
  if (!isScreenMode || document.hidden || refreshTimer) {
    return;
  }

  stopIdleCheck();
  refreshTimer = window.setInterval(() => {
    fetchWords()
      .then(({ changed }) => {
        if (!changed && Date.now() - lastWordsChangedAt >= idleTimeoutMs) {
          enterIdleMode();
          return;
        }

        setStatus(changed ? `${new Date().toLocaleTimeString("ja-JP")} 更新` : "自動更新中");
      })
      .catch((error) => setStatus(error.message));
  }, activeRefreshMs);
}

function stopAutoRefresh() {
  if (!refreshTimer) {
    return;
  }

  window.clearInterval(refreshTimer);
  refreshTimer = null;
}

function startIdleCheck() {
  if (!isScreenMode || document.hidden || idleCheckTimer) {
    return;
  }

  idleCheckTimer = window.setInterval(() => {
    fetchWords()
      .then(({ changed }) => {
        if (!changed) {
          return;
        }

        stopIdleCheck();
        startAutoRefresh();
        setStatus(`${new Date().toLocaleTimeString("ja-JP")} 新しい投稿を検知`);
      })
      .catch((error) => setStatus(error.message));
  }, idleCheckMs);
}

function stopIdleCheck() {
  if (!idleCheckTimer) {
    return;
  }

  window.clearInterval(idleCheckTimer);
  idleCheckTimer = null;
}

function enterIdleMode() {
  stopAutoRefresh();
  startIdleCheck();
  setStatus("2分間更新がないため待機中");
}

function resumeAutoRefreshForWordUpdate() {
  if (!isScreenMode || document.hidden) {
    return;
  }

  lastWordsChangedAt = Date.now();
  stopIdleCheck();
  startAutoRefresh();
  fetchWords({ forceRender: true })
    .then(() => setStatus(`${new Date().toLocaleTimeString("ja-JP")} 新しい投稿を検知`))
    .catch((error) => setStatus(error.message));
}

function startTitleRefresh() {
  if (titleRefreshTimer) {
    return;
  }

  titleRefreshTimer = window.setInterval(() => {
    syncActiveRoom().catch((error) => setStatus(error.message));
  }, 6000);
}

async function replaceRoom(nextRoom) {
  const nextTitle = normalizeRoom(nextRoom);
  const password = adminToken ? "" : requestAdminPassword("タイトル適用");
  room = await applyTitle(nextTitle, password);
  params.set("room", room);
  if (adminToken) {
    params.set("token", adminToken);
  }
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  updateRoomUi();
  notifyStateChange(room, displayMode, displayTitle, isAccepting);
  await fetchWords();
  setStatus(isScreenMode ? "自動更新中" : "タイトルを適用し、表示をリセットしました。");
}

if (roomForm) {
  roomForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await replaceRoom(roomInput.value);
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAccepting) {
      setStatus("このルームは受付を終了しました。");
      return;
    }

    const word = input.value.trim();
    if (!word) {
      return;
    }

    try {
      await submitWord(word);
      input.value = "";
      input.focus();
      setStatus(`「${word}」を送信しました。`);
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (wordModeButton) {
  wordModeButton.addEventListener("click", async () => {
    try {
      await applyDisplayMode("tokens");
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (rawModeButton) {
  rawModeButton.addEventListener("click", async () => {
    try {
      await applyDisplayMode("raw");
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (acceptanceToggleButton) {
  acceptanceToggleButton.addEventListener("click", async () => {
    try {
      await applyAcceptance(!isAccepting);
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (csvExportButton) {
  csvExportButton.addEventListener("click", async () => {
    try {
      await exportCsv();
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (participantQrCard) {
  participantQrCard.addEventListener("click", toggleParticipantQr);
  participantQrCard.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleParticipantQr();
    }
  });
}

if (participantQrBackdrop) {
  participantQrBackdrop.addEventListener("click", () => setParticipantQrExpanded(false));
}

updateRoomUi();
syncActiveRoom()
  .catch(() => room)
  .then(() => fetchWords())
  .then(() => setStatus(isScreenMode ? "自動更新中" : "準備完了です。"))
  .catch((error) => setStatus(error.message));

startTitleRefresh();

if (isScreenMode) {
  window.addEventListener("storage", (event) => {
    if (event.key === activeRoomStorageKey && event.newValue) {
      const state = parseCachedState(event.newValue);
      if (!usesRoomScopedState || normalizeRoom(state.room) === room) {
        applyIncomingState(state.room, state.mode, state.title, state.accepting);
      }
    }

    if (event.key === wordUpdateStorageKey && event.newValue) {
      try {
        const payload = JSON.parse(event.newValue);
        if (normalizeRoom(payload.room) === room) {
          resumeAutoRefreshForWordUpdate();
        }
      } catch (error) {
        resumeAutoRefreshForWordUpdate();
      }
    }
  });

  if (roomChannel) {
    roomChannel.addEventListener("message", (event) => {
      if (event.data?.room) {
        if (!usesRoomScopedState || normalizeRoom(event.data.room) === room) {
          applyIncomingState(event.data.room, event.data.mode, event.data.title, event.data.accepting);
        }
      }
      if (event.data?.wordsChanged && normalizeRoom(event.data.room) === room) {
        resumeAutoRefreshForWordUpdate();
      }
    });
  }

  startAutoRefresh();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoRefresh();
      stopIdleCheck();
      setStatus("画面が非表示のため更新停止中");
      return;
    }

    fetchWords()
      .then(({ changed }) => {
        if (!changed && Date.now() - lastWordsChangedAt >= idleTimeoutMs) {
          enterIdleMode();
          return;
        }
        setStatus("自動更新中");
      })
      .catch((error) => setStatus(error.message));
    startAutoRefresh();
  });
}
