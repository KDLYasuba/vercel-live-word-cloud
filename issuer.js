const issuerForm = document.getElementById("issuer-form");
const issuerStatus = document.getElementById("status");
const issuerResult = document.getElementById("issuer-result");
const issuerAdminUrl = document.getElementById("issuer-admin-url");
const issuerParticipantUrl = document.getElementById("issuer-participant-url");
const issuerScreenUrl = document.getElementById("issuer-screen-url");

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
    } catch (error) {
      setIssuerStatus(error.message);
    }
  });
}
