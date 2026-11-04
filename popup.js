const content = document.getElementById("content");
const refreshBtn = document.getElementById("refresh");

let currentUrl = null;

document.addEventListener("DOMContentLoaded", init);
refreshBtn.addEventListener("click", () => load(currentUrl, true));

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url || !tab.url.startsWith("https://")) {
    renderState("Not an HTTPS page", "Domain checks only run on secure sites.");
    return;
  }

  currentUrl = tab.url;
  await load(currentUrl, false);
}

async function load(url, fresh) {
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "lookup", url, fresh });
    if (!response?.info) throw new Error(response?.error || "No answer from the background worker.");
    renderInfo(response.info);
  } catch (error) {
    content.innerHTML = `<div class="error"><div class="error-body">${esc(
      error.message || "Lookup failed."
    )}</div></div>`;
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  refreshBtn.disabled = busy;
  refreshBtn.classList.toggle("spin", busy);
}

function renderInfo(info) {
  const statusList = info.status ?? [];
  const nameserverList = info.nameservers ?? [];

  const badge = info.isNew
    ? `<span class="badge new">Newly registered</span>`
    : info.daysOld === null
      ? `<span class="badge">Unknown age</span>`
      : `<span class="badge ok">Established</span>`;

  const age = info.daysOld === null
    ? "Registration date unavailable"
    : `Registered <b>${ageText(info.daysOld)}</b> ago`;

  const host = info.host && info.host !== info.domain ? info.host : null;

  const note = info.isNew
    ? `<p class="note">This domain is very recent. Recently registered domains are often used
       for phishing and fake shops — double-check before signing in or paying.</p>`
    : "";

  const rows = [
    ["Registrar", info.registrar, false],
    ["Registered", formatDate(info.registeredAt), false],
    ["Expires", formatDate(info.expiresAt), false],
    ["Updated", formatDate(info.updatedAt), false],
    ["Reported for", host, true],
  ]
    .filter(([, value]) => value)
    .map(
      ([key, value, mono]) =>
        `<div class="row"><dt>${key}</dt><dd${mono ? ' class="mono"' : ""}>${esc(value)}</dd></div>`
    )
    .join("");

  const status = statusList.length
    ? `<section class="section">
         <h2 class="label">Status</h2>
         <div class="chips">${statusList
           .map((s) => `<span class="chip">${esc(s)}</span>`)
           .join("")}</div>
       </section>`
    : "";

  const nameservers = nameserverList.length
    ? `<section class="section">
         <h2 class="label">Nameservers</h2>
         ${nameserverList
           .slice(0, 6)
           .map((ns) => `<div class="row"><dd class="mono">${esc(ns)}</dd></div>`)
           .join("")}
       </section>`
    : "";

  content.innerHTML = `
    <section class="hero">
      <div class="hero-top">
        <h1 class="domain">${esc(info.domain)}</h1>
        ${badge}
      </div>
      <p class="age">${age}</p>
      ${note}
    </section>
    ${rows ? `<section class="section"><h2 class="label">Registration</h2>${rows}</section>` : ""}
    ${status}
    ${nameservers}
    <footer class="actions">
      <button class="btn" id="clear">Clear cache</button>
      <button class="btn primary" id="recheck">Re-check</button>
    </footer>`;

  document.getElementById("recheck").addEventListener("click", () => load(currentUrl, true));
  document.getElementById("clear").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "clear" });
    await load(currentUrl, true);
  });
}

function renderState(title, sub) {
  content.innerHTML = `<div class="state">
      <p class="state-title">${esc(title)}</p>
      <p class="state-sub">${esc(sub)}</p>
    </div>`;
}

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ageText(days) {
  if (days < 1) return "less than a day";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function esc(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}
