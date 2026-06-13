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
const screenLink = document.getElementById("screen-link");
const wordModeButton = document.getElementById("word-mode-button");
const rawModeButton = document.getElementById("raw-mode-button");
const participantQr = document.getElementById("participant-qr");
const participantQrCard = document.querySelector(".participant-qr-card");
const participantQrBackdrop = document.getElementById("participant-qr-backdrop");
const participantUrlEl = document.getElementById("participant-url");

const isScreenMode = window.location.pathname === "/screen";
const params = new URLSearchParams(window.location.search);
const activeRoomStorageKey = "vercel-live-word-cloud-active-room";
const roomChannel = "BroadcastChannel" in window ? new BroadcastChannel("vercel-live-word-cloud-room") : null;
const cachedState = parseCachedState(readCachedRoom());
let room = normalizeRoom(params.get("room") || cachedState.room || "main");
let displayMode = normalizeMode(cachedState.mode);
let refreshTimer = null;
let titleRefreshTimer = null;

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
    currentRoomEl.textContent = room;
  }

  if (participantRoomTitleEl) {
    participantRoomTitleEl.textContent = room;
  }

  if (roomInput) {
    roomInput.value = room;
  }

  if (screenLink) {
    screenLink.href = `/screen?room=${encodeURIComponent(room)}`;
  }

  if (wordModeButton) {
    wordModeButton.classList.toggle("is-active", displayMode === "tokens");
  }

  if (rawModeButton) {
    rawModeButton.classList.toggle("is-active", displayMode === "raw");
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

function notifyStateChange(nextRoom, nextMode) {
  const state = JSON.stringify({
    room: nextRoom,
    mode: normalizeMode(nextMode),
  });

  try {
    window.localStorage.setItem(activeRoomStorageKey, state);
  } catch (error) {
    // localStorage may be unavailable in some embedded browsers.
  }

  if (roomChannel) {
    roomChannel.postMessage({ room: nextRoom, mode: normalizeMode(nextMode) });
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
      mode: normalizeMode(parsed.mode),
    };
  } catch (error) {
    return { room: value, mode: "raw" };
  }
}

function applyIncomingState(nextRoom, nextMode) {
  const normalized = normalizeRoom(nextRoom);
  const normalizedMode = normalizeMode(nextMode);
  if (normalized === room && normalizedMode === displayMode) {
    return;
  }

  room = normalized;
  displayMode = normalizedMode;
  params.set("room", room);
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  updateRoomUi();
  fetchWords()
    .then(() => setStatus(isScreenMode ? "自動更新中" : "タイトルを切り替えました。"))
    .catch((error) => setStatus(error.message));
}

async function fetchActiveRoom() {
  const response = await fetch("/api/title", {
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Title fetch failed");
  }

  return {
    room: normalizeRoom(payload.room),
    mode: normalizeMode(payload.mode),
  };
}

async function syncActiveRoom() {
  const activeState = await fetchActiveRoom();
  applyIncomingState(activeState.room, activeState.mode);
  return activeState;
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

  let hash = 0;
  for (let i = 0; i < word.length; i += 1) {
    hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
  }

  return palette[hash % palette.length];
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

function estimateChipWidth(text, fontSize) {
  return Math.max(fontSize * 2.4, text.length * fontSize * 0.74);
}

function estimateChipHeight(fontSize) {
  return fontSize * 1.9;
}

function intersects(a, b) {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

function buildCandidatePositions(baseX, baseY, width, height, marginX, marginY) {
  const candidates = [{ x: baseX, y: baseY }];
  const radiusSteps = isScreenMode ? [24, 48, 72, 96, 132, 170, 210, 250, 300] : [18, 36, 54, 72, 96, 124, 154];
  const angleSteps = 12;

  for (const radius of radiusSteps) {
    for (let i = 0; i < angleSteps; i += 1) {
      const angle = (Math.PI * 2 * i) / angleSteps;
      const x = Math.min(width - marginX, Math.max(marginX, baseX + Math.cos(angle) * radius));
      const y = Math.min(height - marginY, Math.max(marginY, baseY + Math.sin(angle) * radius));
      candidates.push({ x, y });
    }
  }

  return candidates;
}

function buildGridBasePosition(index, columns, rows, width, height) {
  const col = index % columns;
  const row = Math.floor(index / columns);
  const jitterX = ((index * 41) % 20) - 10;
  const jitterY = ((index * 59) % 24) - 12;

  return {
    x: ((col + 0.5) / columns) * width + jitterX * (isScreenMode ? 8 : 5),
    y: ((row + 0.5) / rows) * height + jitterY * (isScreenMode ? 7 : 4),
  };
}

function buildRankedBasePosition(index, total, width, height) {
  if (index === 0) {
    return { x: width * 0.5, y: height * 0.5 };
  }

  const progress = Math.sqrt(index / Math.max(1, total - 1));
  const angle = index * 2.399963229728653;
  const radiusX = width * (isScreenMode ? 0.42 : 0.38) * progress;
  const radiusY = height * (isScreenMode ? 0.36 : 0.32) * progress;

  return {
    x: width * 0.5 + Math.cos(angle) * radiusX,
    y: height * 0.5 + Math.sin(angle) * radiusY,
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
    uniqueCountEl.textContent = String(words.length);
  }

  if (!words.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "まだワードがありません。";
    empty.style.padding = "20px";
    cloud.appendChild(empty);
    return;
  }

  const columns = Math.max(2, Math.ceil(Math.sqrt(words.length)));
  const rows = Math.max(2, Math.ceil(words.length / columns));
  const width = cloud.clientWidth || (isScreenMode ? 1400 : 800);
  const height = cloud.clientHeight || (isScreenMode ? 800 : 560);
  const placedBoxes = [];

  words.forEach((item, index) => {
    const label = item.word;
    const sizeInfo = sizeForCount(item.count);
    const fontSize = sizeInfo.size;
    const basePosition =
      displayMode === "tokens"
        ? buildRankedBasePosition(index, words.length, width, height)
        : buildGridBasePosition(index, columns, rows, width, height);
    const rawX = basePosition.x;
    const rawY = basePosition.y;
    const chipWidth = estimateChipWidth(label, fontSize);
    const chipHeight = estimateChipHeight(fontSize);
    const marginX = chipWidth / 2 + 34;
    const marginY = chipHeight / 2 + 30;
    const safeX = Math.min(width - marginX, Math.max(marginX, rawX));
    const safeY = Math.min(height - marginY, Math.max(marginY, rawY));
    const candidates = buildCandidatePositions(safeX, safeY, width, height, marginX, marginY);

    let chosen = { x: safeX, y: safeY };
    for (const candidate of candidates) {
      const box = {
        left: candidate.x - chipWidth / 2,
        right: candidate.x + chipWidth / 2,
        top: candidate.y - chipHeight / 2,
        bottom: candidate.y + chipHeight / 2,
      };

      if (!placedBoxes.some((placed) => intersects(box, placed))) {
        chosen = candidate;
        placedBoxes.push(box);
        break;
      }
    }

    if (placedBoxes.length <= index) {
      placedBoxes.push({
        left: chosen.x - chipWidth / 2,
        right: chosen.x + chipWidth / 2,
        top: chosen.y - chipHeight / 2,
        bottom: chosen.y + chipHeight / 2,
      });
    }

    const chip = document.createElement("span");
    chip.className = `word-chip ${displayMode === "raw" ? "raw-chip" : "token-chip"}`;
    chip.textContent = label;
    chip.style.left = `${chosen.x}px`;
    chip.style.top = `${chosen.y}px`;
    chip.style.fontSize = `${fontSize}px`;
    chip.style.maxWidth = `${Math.max(160, width / columns - 10)}px`;
    chip.style.background = "transparent";
    chip.style.color = colorForWord(label);
    chip.style.setProperty("--rotate", `${index % 3 === 0 ? "-4deg" : index % 3 === 1 ? "0deg" : "4deg"}`);
    cloud.appendChild(chip);
  });
}

async function fetchWords() {
  const response = await fetch(`/api/words?room=${encodeURIComponent(room)}&mode=${encodeURIComponent(displayMode)}`, {
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Fetch failed");
  }

  render(payload.words || []);
  return payload;
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

  render(payload.words || []);
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
    body: JSON.stringify({ password }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Reset failed");
  }

  render([]);
}

async function applyTitle(targetRoom, password) {
  const nextRoom = normalizeRoom(targetRoom);
  const response = await fetch("/api/title", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ room: nextRoom, mode: displayMode, password }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Title apply failed");
  }

  render([]);
  displayMode = normalizeMode(payload.mode);
  return normalizeRoom(payload.room);
}

async function applyDisplayMode(nextMode) {
  const normalizedMode = normalizeMode(nextMode);
  const response = await fetch("/api/title", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ room, mode: normalizedMode, reset: false }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Mode apply failed");
  }

  room = normalizeRoom(payload.room);
  displayMode = normalizeMode(payload.mode);
  updateRoomUi();
  notifyStateChange(room, displayMode);
  await fetchWords();
  setStatus(displayMode === "tokens" ? "Goワード表示に切り替えました。" : "原文表示に戻しました。");
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

function startAutoRefresh() {
  if (!isScreenMode || document.hidden || refreshTimer) {
    return;
  }

  refreshTimer = window.setInterval(() => {
    fetchWords()
      .then(() => {
        setStatus(`${new Date().toLocaleTimeString("ja-JP")} 更新`);
      })
      .catch((error) => setStatus(error.message));
  }, 6000);
}

function stopAutoRefresh() {
  if (!refreshTimer) {
    return;
  }

  window.clearInterval(refreshTimer);
  refreshTimer = null;
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
  const nextNormalizedRoom = normalizeRoom(nextRoom);
  const password = requestAdminPassword("タイトル適用");
  room = await applyTitle(nextNormalizedRoom, password);
  params.set("room", room);
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  updateRoomUi();
  notifyStateChange(room, displayMode);
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
      applyIncomingState(state.room, state.mode);
    }
  });

  if (roomChannel) {
    roomChannel.addEventListener("message", (event) => {
      if (event.data?.room) {
        applyIncomingState(event.data.room, event.data.mode);
      }
    });
  }

  startAutoRefresh();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoRefresh();
      setStatus("画面が非表示のため更新停止中");
      return;
    }

    fetchWords()
      .then(() => setStatus("自動更新中"))
      .catch((error) => setStatus(error.message));
    startAutoRefresh();
  });
}
