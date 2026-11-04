const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_DOMAIN_DAYS = 30;
const WARNED_TTL_MS = 24 * 60 * 60 * 1000;

const cacheKey = (domain) => `rdap:${domain}`;
const warnedKey = (domain) => `warned:${domain}`;

function domainFromUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname ? hostname : null;
  } catch {
    return null;
  }
}

function vcardValue(vcardArray, field) {
  const entries = vcardArray?.[1];
  if (!Array.isArray(entries)) return null;
  const hit = entries.find((entry) => entry[0] === field);
  const value = hit?.[3];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function summarize(domain, data) {
  const events = {};
  for (const event of data.events ?? []) events[event.eventAction] = event.eventDate;

  const registeredAt = events.registration ?? events.created ?? null;
  const daysOld = registeredAt
    ? Math.floor((Date.now() - Date.parse(registeredAt)) / 86_400_000)
    : null;

  const registrar = (data.entities ?? []).find((entity) =>
    (entity.roles ?? []).includes("registrar")
  );

  return {
    domain,
    registeredAt,
    expiresAt: events.expiration ?? null,
    updatedAt: events["last changed"] ?? null,
    daysOld,
    isNew: daysOld !== null && daysOld <= NEW_DOMAIN_DAYS,
    registrar: registrar ? vcardValue(registrar.vcardArray, "fn") : null,
    status: data.status ?? [],
    nameservers: (data.nameservers ?? []).map((ns) => ns.ldhName).filter(Boolean),
    fetchedAt: Date.now(),
  };
}

async function getBootstrap() {
  const stored = (await chrome.storage.local.get("rdap:bootstrap"))["rdap:bootstrap"];
  if (stored && Date.now() - stored.savedAt < BOOTSTRAP_TTL_MS) return stored.map;

  const response = await fetch(BOOTSTRAP_URL);
  if (!response.ok) throw new Error(`RDAP bootstrap unavailable (${response.status})`);

  const { services } = await response.json();
  const map = {};
  for (const [tlds, urls] of services ?? []) {
    for (const tld of tlds) map[tld.toLowerCase()] = urls[0];
  }

  await chrome.storage.local.set({ "rdap:bootstrap": { savedAt: Date.now(), map } });
  return map;
}

// Longest registered suffix wins, so co.uk beats uk.
function rdapBase(domain, map) {
  const parts = domain.toLowerCase().split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const base = map[parts.slice(i + 1).join(".")];
    if (base) return base;
  }
  return null;
}

async function lookup(domain, fresh = false) {
  const key = cacheKey(domain);
  if (!fresh) {
    const cached = (await chrome.storage.local.get(key))[key];
    if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.info;
  }

  const endpoint = rdapBase(domain, await getBootstrap());
  if (!endpoint) throw new Error(`No RDAP server for ${domain}`);

  // Subdomains are not registered on their own: walk up until the registry answers.
  let candidate = domain;
  let data = null;
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/domain/${encodeURIComponent(candidate)}`,
      { headers: { Accept: "application/rdap+json" } }
    );
    if (response.ok) {
      data = await response.json();
      break;
    }
    if (response.status !== 404) throw new Error(`RDAP returned ${response.status}`);
    const parts = candidate.split(".");
    if (parts.length <= 2) break;
    parts.shift();
    candidate = parts.join(".");
  }
  if (!data) throw new Error(`No RDAP record for ${domain}`);

  const info = { ...summarize(candidate, data), host: domain };
  await chrome.storage.local.set({ [key]: { savedAt: Date.now(), info } });
  return info;
}

async function warnTab(tabId, info) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "rdap:warning",
      domain: info.domain,
      daysOld: info.daysOld,
      registeredAt: info.registeredAt,
    });
  } catch {
    // Content script not ready yet (page still loading) — the popup still shows the data.
  }

  const key = warnedKey(info.domain);
  const lastWarned = (await chrome.storage.local.get(key))[key];
  if (lastWarned && Date.now() - lastWarned < WARNED_TTL_MS) return;

  await chrome.storage.local.set({ [key]: Date.now() });
  await chrome.notifications.create(`new-domain:${info.domain}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Newly registered domain",
    message: `${info.domain} was registered ${info.daysOld} day(s) ago. Avoid entering sensitive data.`,
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const domain = domainFromUrl(tab.url);
  if (!domain) return;

  (async () => {
    try {
      const info = await lookup(domain);
      if (info.isNew) await warnTab(tabId, info);
    } catch (error) {
      console.warn("RDAP lookup failed:", domain, error.message);
    }
  })();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "lookup") {
        const domain = domainFromUrl(message.url);
        if (!domain) {
          sendResponse({ error: "Only HTTPS pages are supported." });
          return;
        }
        sendResponse({ info: await lookup(domain, Boolean(message.fresh)) });
        return;
      }

      if (message?.type === "clear") {
        await chrome.storage.local.clear();
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ error: "Unknown request." });
    } catch (error) {
      sendResponse({ error: error.message || "Lookup failed." });
    }
  })();
  return true;
});
