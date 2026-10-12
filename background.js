importScripts("classifier.js");

const OPENED_KEY = "waLeadFoldersQuickOpened";
const CONTEXT_ACTIONS = {
  "walf-message": "message",
  "walf-call": "call"
};

async function openWhatsApp(phone, action, force = false, requestedTarget = null) {
  const stored = await chrome.storage.local.get(["preferredTarget", "defaultCountryCode", "cooldownMinutes"]);
  const target = requestedTarget === "app" || requestedTarget === "web"
    ? requestedTarget : stored.preferredTarget === "web" ? "web" : "app";
  const digits = normalizeQuickPhone(phone, stored.defaultCountryCode || "+213");
  if (!digits) return { ok: false, error: "invalid-phone" };
  const url = target === "web"
    ? `https://web.whatsapp.com/send/?phone=${digits}&text&type=${action === "call" ? "call" : "phone_number"}&app_absent=0`
    : `https://api.whatsapp.com/send/?phone=${digits}&text&type=${action === "call" ? "call" : "phone_number"}&app_absent=0`;

  const normalized = `+${digits}`;
  const opened = (await chrome.storage.local.get(OPENED_KEY))[OPENED_KEY] || {};
  const elapsed = Date.now() - Number(opened[normalized] || 0);
  const cooldown = Math.max(0, Number(stored.cooldownMinutes ?? 15));
  if (!force && cooldown > 0 && elapsed < cooldown * 60 * 1000) {
    return { ok: false, blocked: true, minutesAgo: Math.floor(elapsed / 60000), target };
  }

  const tabs = target === "web" ? await chrome.tabs.query({ url: "https://web.whatsapp.com/*" }) : [];
  const existing = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  const tab = existing
    ? await chrome.tabs.update(existing.id, { url, active: true })
    : await chrome.tabs.create({ url, active: true });
  if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});

  opened[normalized] = Date.now();
  const recent = Object.entries(opened).sort((a, b) => b[1] - a[1]).slice(0, 200);
  await chrome.storage.local.set({ [OPENED_KEY]: Object.fromEntries(recent) });
  return { ok: true, phone: normalized, target, reusedTab: Boolean(existing) };
}

function normalizeQuickPhone(raw, defaultCountryCode = "+213") {
  const text = String(raw || "").trim();
  if (!/^\+?[\d\s().-]{8,}$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (text.startsWith("+")) return digits;
  const country = String(defaultCountryCode).replace(/\D/g, "");
  if (digits.startsWith("0")) return `${country}${digits.slice(1)}`;
  if (country && digits.length <= 10 && !digits.startsWith(country)) return `${country}${digits}`;
  return digits;
}

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "walf-phone", title: "WhatsApp", contexts: ["selection", "link"] });
    chrome.contextMenus.create({ id: "walf-message", parentId: "walf-phone", title: "Message", contexts: ["selection", "link"] });
    chrome.contextMenus.create({ id: "walf-call", parentId: "walf-phone", title: "Call", contexts: ["selection", "link"] });
  });
}

chrome.runtime.onInstalled.addListener(createContextMenus);
chrome.runtime.onStartup.addListener(createContextMenus);

chrome.contextMenus.onClicked.addListener((info) => {
  const action = CONTEXT_ACTIONS[info.menuItemId];
  if (!action) return;
  const phone = info.selectionText?.trim()
    || (info.linkUrl?.startsWith("tel:") ? decodeURIComponent(info.linkUrl.slice(4)).trim() : "");
  if (phone) void openWhatsApp(phone, action, true);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "WALF_OPEN_PHONE") {
    openWhatsApp(message.phone, message.action, message.force).then(respond);
    return true;
  }
  if (message?.type === "WA_GET_SETTINGS") {
    chrome.storage.local.get([
      "defaultCountryCode", "preferredTarget", "cooldownMinutes", "detectionEnabled",
      "domainMode", "scopedDomains", "blockedDomains"
    ]).then((settings) => respond({
      defaultCountryCode: settings.defaultCountryCode ?? "+213",
      preferredTarget: settings.preferredTarget || "app",
      cooldownMinutes: typeof settings.cooldownMinutes === "number" ? settings.cooldownMinutes : 15,
      detectionEnabled: settings.detectionEnabled !== false,
      domainMode: settings.domainMode === "allowlist" ? "allowlist" : "all",
      scopedDomains: Array.isArray(settings.scopedDomains) ? settings.scopedDomains : [],
      blockedDomains: Array.isArray(settings.blockedDomains) ? settings.blockedDomains : []
    }));
    return true;
  }
  if (message?.type === "WA_OPEN") {
    openWhatsApp(message.raw, message.action, Boolean(message.force), message.target).then((result) => {
      if (result.blocked && sender.tab?.id) {
        void chrome.tabs.sendMessage(sender.tab.id, { type: "WA_COOLDOWN", payload: result });
      }
      respond(result);
    });
    return true;
  }
  if (message?.type === "WA_RESOLVE") {
    chrome.storage.local.get("defaultCountryCode").then((settings) => respond({
      digits: normalizeQuickPhone(message.raw, settings.defaultCountryCode || "+213"),
      settings
    }));
    return true;
  }
});
