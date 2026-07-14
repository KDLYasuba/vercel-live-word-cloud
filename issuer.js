const issuerForm = document.getElementById("issuer-form");
const issuerStatus = document.getElementById("status");
const issuerResult = document.getElementById("issuer-result");
const issuerAdminUrl = document.getElementById("issuer-admin-url");
const issuerParticipantUrl = document.getElementById("issuer-participant-url");
const issuerScreenUrl = document.getElementById("issuer-screen-url");
const issuerList = document.getElementById("issuer-list");
const issuerListRefresh = document.getElementById("issuer-list-refresh");
const issuerPasswordInput = document.getElementById("issuer-password");

function setIssuerStatus(message) {
  if (issuerStatus) {
    issuerStatus.textContent = message;
  }
}

function toIsoDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "期限なし";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function renderIssuerList(events) {
  if (!issuerList) {
    return;
  }

  issuerList.textContent = "";
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "field-note";
    empty.textContent = "発行済みURLはまだありません。";
    issuerList.appendChild(empty);
    return;
  }

  for (const event of events) {
    const item = document.createElement("article");
    item.className = "issuer-list-item";

    const titleRow = document.createElement("div");
    titleRow.className = "issuer-list-title-row";

    const title = document.createElement("strong");
    title.textContent = event.title || event.room;

    const badge = document.createElement("span");
    badge.className = `issuer-status-badge ${event.expired ? "is-expired" : "is-active"}`;
    badge.textContent = event.expired ? "期限切れ" : "有効";

    titleRow.append(title, badge);

    const expires = document.createElement("p");
    expires.className = "issuer-list-meta";
    expires.textContent = `期限: ${formatDateTime(event.expiresAt)}`;

    const adminLabel = document.createElement("label");
    adminLabel.textContent = "司会者URL";
    const adminUrl = document.createElement("input");
    adminUrl.type = "text";
    adminUrl.readOnly = true;
    adminUrl.value = event.adminUrl || "";

    const linkRow = document.createElement("div");
    linkRow.className = "issuer-list-links";

    const participantLink = document.createElement("a");
    participantLink.className = "ghost-button";
    participantLink.href = event.participantUrl || "#";
    participantLink.target = "_blank";
    participantLink.rel = "noopener noreferrer";
    participantLink.textContent = "参加者";

    const screenLink = document.createElement("a");
    screenLink.className = "ghost-button";
    screenLink.href = event.screenUrl || "#";
    screenLink.target = "_blank";
    screenLink.rel = "noopener noreferrer";
    screenLink.textContent = "表示";

    linkRow.append(participantLink, screenLink);
    item.append(titleRow, expires, adminLabel, adminUrl, linkRow);
    issuerList.appendChild(item);
  }
}

async function loadIssuerList() {
  const password = String(issuerPasswordInput?.value || "");
  if (!password) {
    setIssuerStatus("一覧を表示するには発行パスワードを入力してください。");
    return;
  }

  if (issuerList) {
    issuerList.innerHTML = '<p class="field-note">読み込み中です...</p>';
  }

  const response = await fetch("/api/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "list", password }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "一覧の取得に失敗しました。");
  }

  renderIssuerList(payload.events || []);
  setIssuerStatus("発行済みURL一覧を更新しました。");
}

if (issuerForm) {
  issuerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(issuerForm);
    const title = String(formData.get("title") || "").trim();
    const expiresAt = toIsoDateTime(formData.get("expiresAt"));
    const password = String(formData.get("password") || "");

    try {
      setIssuerStatus("発行中です...");
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, expiresAt, password }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || "発行に失敗しました。");
      }

      issuerAdminUrl.value = payload.adminUrl;
      issuerParticipantUrl.value = payload.participantUrl;
      issuerScreenUrl.value = payload.screenUrl;
      issuerResult.classList.remove("is-hidden");
      setIssuerStatus("発行しました。司会者URLを共有してください。");
      await loadIssuerList();
    } catch (error) {
      setIssuerStatus(error.message);
    }
  });
}

if (issuerListRefresh) {
  issuerListRefresh.addEventListener("click", async () => {
    try {
      await loadIssuerList();
    } catch (error) {
      setIssuerStatus(error.message);
    }
  });
}
