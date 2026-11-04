const HOST_ID = "rdap-domain-intel";

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "rdap:warning") return;
  if (!document.body || document.getElementById(HOST_ID)) return;
  showWarning(message);
});

function showWarning({ domain, daysOld, registeredAt }) {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "all:initial;position:fixed;inset:0 0 auto 0;z-index:2147483647;display:flex;justify-content:center;pointer-events:none;";

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap {
        --radius: 8px;
        pointer-events: auto;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: min(520px, calc(100vw - 24px));
        margin: 12px;
        padding: 12px 12px 12px 14px;
        border: 1px solid #e7e9ee;
        border-radius: var(--radius);
        background: #ffffff;
        color: #14181f;
        box-shadow: 0 8px 24px rgba(16, 20, 24, .12);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity .2s ease, transform .2s ease;
      }
      .wrap.in { opacity: 1; transform: translateY(0); }

      .icon {
        flex: 0 0 auto;
        width: 26px;
        height: 26px;
        border-radius: var(--radius);
        display: grid;
        place-items: center;
        background: #fef3f2;
        color: #b42318;
        font-size: 13px;
        font-weight: 700;
      }

      .body { flex: 1; min-width: 0; }
      .title { font-size: 13px; font-weight: 600; line-height: 1.4; }
      .text { margin: 2px 0 0; font-size: 12px; color: #6b7280; line-height: 1.5; }
      .text b { color: #14181f; font-weight: 600; }

      .close {
        flex: 0 0 auto;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #98a1ad;
        font: 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        cursor: pointer;
      }
      .close:hover { background: #f7f8fa; color: #14181f; }

      @media (prefers-color-scheme: dark) {
        .wrap { background: #161b21; border-color: #262c34; color: #e7ebf0; box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
        .icon { background: #241514; color: #ff8a7a; }
        .text { color: #98a1ad; }
        .text b { color: #e7ebf0; }
        .close { color: #98a1ad; }
        .close:hover { background: #0f1216; color: #e7ebf0; }
      }

      @media (prefers-reduced-motion: reduce) {
        .wrap { transition: none; }
      }
    </style>
    <div class="wrap" role="alert">
      <div class="icon">!</div>
      <div class="body">
        <div class="title">Newly registered domain</div>
        <p class="text"><b>${escapeHtml(domain)}</b> was registered only
          <b>${Number(daysOld)} day(s)</b> ago. Be careful with passwords and payments.</p>
        <p class="text" id="date"></p>
      </div>
      <button class="close" title="Dismiss" aria-label="Dismiss">✕</button>
    </div>`;

  const wrap = shadow.querySelector(".wrap");
  const dateLine = shadow.querySelector("#date");

  if (registeredAt) {
    const date = new Date(registeredAt);
    if (!Number.isNaN(date.getTime())) {
      dateLine.textContent = `Registered on ${date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`;
    }
  }
  if (!dateLine.textContent) dateLine.remove();

  shadow.querySelector(".close").addEventListener("click", () => host.remove());
  document.body.appendChild(host);
  requestAnimationFrame(() => wrap.classList.add("in"));
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}
