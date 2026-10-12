(() => {
  if (!location.pathname.includes("/latest/inbox/")) return;

  const STATE_KEY = "waLeadFoldersState";
  const INDEX_KEY = "waLeadFoldersMetaIndex";
  const WA_INDEX_KEY = "waLeadFoldersWhatsAppIndex";
  const FILTER_KEY = "waLeadFoldersMetaFilter";
  const { metaLeadFields, metaMatchStatus, metaThreadUrl, normalizedName, normalizedPhone } = WALeadFoldersClassifier;
  const PHONE_PATTERN = /(?:(?:\+|00)?213[\s.\-]*0?[567](?:[\s.\-]*\d){8}|0[567](?:[\s.\-]*\d){8})/g;
  const WA_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 14.4c-.3-.2-1.8-.9-2-.9-.3-.1-.5-.2-.7.1l-.9 1.2c-.2.2-.4.2-.7.1-2.2-1.1-3.7-2-5.2-4.5-.1-.3 0-.5.1-.6l.7-.9c.1-.2.1-.4 0-.6L8 6.1c-.2-.6-.5-.5-.7-.5-1 0-2.1.8-2.1 2.5 0 1.5 1.1 2.9 1.2 3.1 1.4 2.1 3.2 4 6.3 5.3 2.4 1 3.5.9 4.8.6.7-.2 1.8-.8 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.4M12 22a10 10 0 0 1-5-1.4L1.5 22l1.5-5.3A10 10 0 1 1 12 22Z"/></svg>`;
  const COPY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"/></svg>`;
  const OUTCOMES = {
    "has-wa": "Has WhatsApp",
    "messaged-wa": "Messaged on WA",
    "no-wa": "No WhatsApp",
    invalid: "Invalid phone",
    converted: "Converted"
  };
  let state = { contacts: {}, folders: [], outcomes: {} };
  let index = { whatsapp: {}, messenger: {}, review: {} };
  let whatsappIndex = {};
  let filterOn = sessionStorage.getItem(FILTER_KEY) === "1";
  let syncing = false;
  let refreshTimer;
  let extensionContextInvalidated = false;
  let pendingMetaSelection = null;

  function handleExtensionContextError(error) {
    if (!/Extension context invalidated/i.test(String(error?.message || error))) return false;
    extensionContextInvalidated = true;
    if (refreshTimer) clearInterval(refreshTimer);
    return true;
  }

  async function storageGet(keys) {
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      if (handleExtensionContextError(error)) return null;
      throw error;
    }
  }

  async function storageSet(value) {
    try {
      await chrome.storage.local.set(value);
      return true;
    } catch (error) {
      if (handleExtensionContextError(error)) return false;
      throw error;
    }
  }
  let metaQueue = [];
  let persistentQueue = [];

  function closePhoneBubble() {
    document.querySelector(".mbwa-phone.is-active")?.classList.remove("is-active");
    document.getElementById("mbwa-phone-bubble")?.remove();
  }

  function quickToast(message, actionLabel, action) {
    document.getElementById("mbwa-quick-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "mbwa-quick-toast";
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(text);
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = actionLabel;
      button.onclick = () => { toast.remove(); action(); };
      toast.append(button);
    }
    document.documentElement.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    if (!action) setTimeout(() => toast.remove(), 2800);
  }

  function openPhone(phone, action = "message", force = false) {
    chrome.runtime.sendMessage({ type: "WALF_OPEN_PHONE", phone, action, force }, (result) => {
      if (chrome.runtime.lastError || result?.error) return quickToast("Could not open this phone number");
      if (result?.blocked) {
        quickToast(`Opened ${result.minutesAgo || 0} min ago`, "Open again", () => openPhone(phone, action, true));
        return;
      }
      quickToast(`${action === "call" ? "Calling" : "Opening"} ${phone} in WhatsApp Web`);
    });
  }

  async function copyPhone(phone) {
    try {
      await navigator.clipboard.writeText(phone);
      quickToast(`${phone} copied`);
    } catch {
      quickToast("Could not copy this phone number");
    }
  }

  function showPhoneBubble(anchor, phone) {
    closePhoneBubble();
    anchor.classList.add("is-active");
    const bubble = document.createElement("div");
    bubble.id = "mbwa-phone-bubble";
    bubble.setAttribute("role", "dialog");
    bubble.setAttribute("aria-label", `WhatsApp actions for ${phone}`);
    const add = (label, className, icon, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.innerHTML = `${icon || ""}<span>${label}</span>`;
      button.onclick = (event) => { event.stopPropagation(); closePhoneBubble(); action(); };
      bubble.append(button);
    };
    const label = document.createElement("small");
    label.textContent = phone;
    bubble.append(label);
    add("Message", "is-primary", WA_ICON, () => openPhone(phone));
    add("Call", "is-secondary", "", () => openPhone(phone, "call"));
    add("Copy", "is-copy", COPY_ICON, () => copyPhone(phone));
    const box = anchor.getBoundingClientRect();
    bubble.style.left = `${box.left + box.width / 2}px`;
    if (box.top > 190) {
      bubble.style.top = `${box.top - 8}px`;
      bubble.classList.add("is-above");
    } else {
      bubble.style.top = `${box.bottom + 8}px`;
    }
    document.documentElement.append(bubble);
    requestAnimationFrame(() => bubble.classList.add("is-visible"));
  }

  function wrapPhoneText(node) {
    const text = node.nodeValue;
    if (!text || !/\d/.test(text) || node.parentElement?.closest(
      "script,style,textarea,input,button,[contenteditable='true'],.mbwa-phone,.wa-qc-phone,.mbwa-status"
    )) return;
    PHONE_PATTERN.lastIndex = 0;
    if (!PHONE_PATTERN.test(text)) return;
    PHONE_PATTERN.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(PHONE_PATTERN)) {
      const phone = normalizedPhone(match[0]);
      if (!phone) continue;
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      const span = document.createElement("span");
      span.className = "mbwa-phone";
      span.role = "button";
      span.tabIndex = 0;
      span.textContent = match[0];
      span.title = `WhatsApp actions for ${phone}`;
      span.onclick = (event) => { event.preventDefault(); event.stopPropagation(); showPhoneBubble(span, phone); };
      span.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") span.click();
      };
      fragment.append(span);
      cursor = match.index + match[0].length;
    }
    if (!cursor) return;
    fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }

  function syncPhoneActions() {
    const region = document.querySelector("[role='region'][aria-label^='Message list container']");
    if (!region) return;
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode() && nodes.length < 500) nodes.push(walker.currentNode);
    nodes.forEach(wrapPhoneText);
  }

  function conversationRows() {
    return [...document.querySelectorAll("[role='presentation']")].map((row) => {
      const channel = row.querySelector("img[alt='WhatsApp'], img[alt='Messenger']")?.alt;
      const titleSurface = row.querySelector("[data-surface$='/lib:thread_title']");
      const title = titleSurface?.textContent?.trim();
      return channel && title ? { row, channel, title, titleSurface, text: row.innerText || row.textContent || "" } : null;
    }).filter(Boolean);
  }

  function remember(channel, aliases, record) {
    let changed = false;
    aliases.filter(Boolean).forEach((alias) => {
      const key = normalizedName(alias);
      const previous = index[channel][key];
      const next = {
        name: record.name,
        phone: record.phone || previous?.phone || null,
        threadId: record.threadId || previous?.threadId || null,
        threadType: record.threadType || previous?.threadType || null,
        mailboxId: record.mailboxId || previous?.mailboxId || null,
        hasWa: Boolean(record.hasWa || previous?.hasWa),
        conversation: Boolean(record.conversation || previous?.conversation)
      };
      if (key && JSON.stringify(previous) !== JSON.stringify(next)) {
        index[channel][key] = next;
        changed = true;
      }
    });
    return changed;
  }

  function rememberWhatsApp(rows) {
    let changed = false;
    rows.filter(({ channel }) => channel === "WhatsApp").forEach(({ title, text }) => {
      const fields = metaLeadFields(text);
      changed = remember("whatsapp", [title, fields.fullName], {
        name: fields.fullName || title, phone: fields.phone, threadId: null,
        hasWa: true, conversation: true
      }) || changed;
    });
    return changed;
  }

  function rememberReviewThread(aliases, route) {
    let changed = false;
    aliases.filter(Boolean).forEach((alias) => {
      const key = normalizedName(alias);
      const previous = index.review[key];
      if (!previous) return;
      const next = { ...previous, ...route };
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        index.review[key] = next;
        changed = true;
      }
    });
    return changed;
  }

  function rememberActiveConversation(rows) {
    const params = new URLSearchParams(location.search);
    const channel = params.get("thread_type") === "FB_MESSAGE" ? "messenger"
      : params.get("thread_type") === "WEC_MESSAGE" ? "whatsapp" : null;
    const selected = rows.find(({ row }) => row.getAttribute("aria-selected") === "true"
      || row.parentElement?.getAttribute("aria-selected") === "true");
    const clickedTitle = pendingMetaSelection
      && params.get("selected_item_id") !== pendingMetaSelection.previousThreadId
      ? pendingMetaSelection.title : null;
    const region = document.querySelector("[role='region'][aria-label^='Message list container']");
    const fields = metaLeadFields(region?.innerText || "");
    const selectedTitle = selected?.title || clickedTitle;
    const name = fields.fullName || selectedTitle;
    const route = {
      threadId: params.get("selected_item_id"),
      threadType: params.get("thread_type"),
      mailboxId: params.get("mailbox_id")
    };
    if (!channel || !name || !route.threadId) return false;
    let changed = remember(channel, [name, selectedTitle], {
      name, phone: fields.phone, ...route,
      hasWa: channel === "whatsapp", conversation: channel === "whatsapp"
    });
    if (channel === "messenger") changed = rememberReviewThread([selectedTitle, fields.fullName], route) || changed;
    if (clickedTitle) pendingMetaSelection = null;
    return changed;
  }

  function normalizeIndex(value) {
    if (!value?.whatsapp || !value?.messenger) return { whatsapp: {}, messenger: {}, review: {} };
    const channels = Object.fromEntries(["whatsapp", "messenger"].map((channel) => [channel,
      Object.fromEntries(Object.entries(value[channel]).map(([key, record]) => [key, {
        ...record, phone: normalizedPhone(record.phone)
      }]))
    ]));
    return {
      ...channels,
      review: value.review && typeof value.review === "object" && !Array.isArray(value.review)
        ? value.review : {}
    };
  }

  function normalizeWhatsAppIndex(value) {
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value).map(([key, record]) => [key, {
      ...record, phone: normalizedPhone(record.phone)
    }]));
  }

  function messengerRecord(title, text) {
    const fields = metaLeadFields(text);
    const exact = index.messenger[normalizedName(fields.fullName || title)];
    if (fields.phone) return { ...exact, name: fields.fullName || title, phone: fields.phone };
    if (exact) return exact;
    const looseName = (value) => normalizedName(value).replace(/([a-z])\1+/g, "$1");
    const looseMatches = Object.values(index.messenger)
      .filter((record) => looseName(record.name) === looseName(title));
    return looseMatches.length === 1 ? looseMatches[0] : { name: title, phone: null };
  }

  function folderFor(match) {
    const contacts = Object.values(state.contacts || {});
    const contact = contacts.find((item) => (match.phone && normalizedPhone(item.name) === match.phone)
      || (match.phone && item.id?.startsWith("phone:") && normalizedPhone(item.id.slice(6)) === match.phone)
      || normalizedName(item.name) === normalizedName(match.name));
    return state.folders?.find((folder) => folder.id === contact?.folderId)?.name || null;
  }

  function outcomeKey(record) {
    return record.phone ? `phone:${record.phone.replace(/\D/g, "")}` : `name:${normalizedName(record.name)}`;
  }

  function rememberReviewRows(rows) {
    let changed = false;
    rows.filter(({ channel }) => channel === "Messenger").forEach((item) => {
      const messenger = messengerRecord(item.title, item.text);
      const key = normalizedName(item.title);
      const previous = index.review[key];
      const position = Number.parseFloat(item.row.parentElement?.style.top);
      const next = {
        key,
        title: item.title,
        text: previous?.text || item.text.replace(/\s+/g, " ").trim().slice(0, 600),
        phone: messenger.phone || previous?.phone || null,
        threadId: messenger.threadId || previous?.threadId || null,
        threadType: messenger.threadType || previous?.threadType || null,
        mailboxId: messenger.mailboxId || previous?.mailboxId || null,
        position: Number.isFinite(position) ? position : previous?.position || 0,
        discoveredAt: previous?.discoveredAt || Date.now()
      };
      if (key && JSON.stringify(previous) !== JSON.stringify(next)) {
        index.review[key] = next;
        changed = true;
      }
    });
    const records = Object.values(index.review);
    if (records.length > 500) {
      records.sort((a, b) => Number(b.discoveredAt) - Number(a.discoveredAt)).slice(500)
        .forEach((record) => { delete index.review[record.key]; });
      changed = true;
    }
    return changed;
  }

  function reviewEntries(whatsappRecords) {
    return Object.values(index.review).map((record) => {
      const found = messengerRecord(record.title, record.text);
      const messenger = { ...found, phone: normalizedPhone(record.phone) || found.phone };
      const result = metaMatchStatus(messenger, whatsappRecords);
      const resolved = result.status === "linked" || result.status === "available"
        || Boolean(state.outcomes?.[outcomeKey(messenger)]);
      return {
        ...record,
        threadId: record.threadId || found.threadId || null,
        threadType: record.threadType || found.threadType || null,
        mailboxId: record.mailboxId || found.mailboxId || null,
        messenger, result, resolved
      };
    }).sort((a, b) => Number(a.position) - Number(b.position) || Number(a.discoveredAt) - Number(b.discoveredAt));
  }

  function openNextMetaLead(currentRow = null) {
    if (filterOn) {
      const next = persistentQueue.find((item) => !item.resolved);
      if (next) void openReviewRecord(next);
      else quickToast("No unchecked Messenger leads have been discovered");
      return;
    }
    const loaded = metaQueue.filter((item) => !item.row.classList.contains("mbwa-filtered-out"));
    if (!loaded.some((item) => !item.resolved)) return quickToast("No unchecked Messenger leads are currently loaded");
    const current = loaded.findIndex((item) => item.row === currentRow
      || item.row.getAttribute("aria-selected") === "true");
    for (let offset = 1; offset <= loaded.length; offset += 1) {
      const candidate = loaded[(current + offset + loaded.length) % loaded.length];
      if (!candidate.resolved) {
        candidate.row.click();
        return;
      }
    }
  }

  function openReviewRecord(record) {
    const mounted = conversationRows().filter((item) => item.channel === "Messenger"
      && normalizedName(item.title) === normalizedName(record.title));
    if (mounted.length === 1) return mounted[0].row.click();
    if (!record.threadId) {
      return quickToast("Open this lead once from Meta's normal list to save its direct thread link");
    }
    location.assign(metaThreadUrl(location.href, record));
  }

  function setStatus(item, result, messenger) {
    const host = item.titleSurface.parentElement;
    const folder = result.status === "linked" && (folderFor(result.match) || result.match.folderName);
    const labels = {
      linked: folder ? `WA chat · ${folder}` : "WA conversation",
      available: "Has WhatsApp",
      saved: "WA saved · unchecked",
      possible: "Same name only",
      unmatched: "Check WhatsApp",
      unknown: "Open to get phone"
    };
    const label = labels[result.status];
    const status = result.status;
    item.row.dataset.mbwaStatus = status;
    host.classList.add("mbwa-title-host");
    let badge = host.querySelector(":scope > .mbwa-status");
    if (!badge) {
      badge = document.createElement("span");
      host.append(badge);
    }
    badge.className = `mbwa-status mbwa-status--${status}`;
    badge.textContent = label;
    const explanations = {
      linked: "Identical phone number and an existing WhatsApp conversation",
      available: "This phone opened successfully in WhatsApp, but no conversation exists yet",
      saved: "This phone was saved by the extension but has not been rechecked",
      possible: "Only the profile name matches; the phone number is not confirmed",
      unmatched: "Phone is known from Messenger but has not been checked in WhatsApp",
      unknown: "Open this Messenger thread so its form phone number can be read"
    };
    badge.title = explanations[result.status];
    let select = host.querySelector(":scope > .mbwa-outcome");
    if (!select) {
      select = document.createElement("select");
      select.className = "mbwa-outcome";
      select.setAttribute("aria-label", `Outcome for ${messenger.name}`);
      select.innerHTML = `<option value="">Set outcome</option>${Object.entries(OUTCOMES)
        .map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}`;
      select.addEventListener("click", (event) => event.stopPropagation());
      select.addEventListener("change", async (event) => {
        event.stopPropagation();
        const key = select.dataset.outcomeKey;
        if (select.value) state.outcomes[key] = { status: select.value, updatedAt: Date.now() };
        else delete state.outcomes[key];
        await storageSet({ [STATE_KEY]: state });
        quickToast(select.value ? `${OUTCOMES[select.value]} saved` : "Outcome cleared");
        await runSync();
        if (select.value) setTimeout(() => openNextMetaLead(item.row), 120);
      });
      host.append(select);
    }
    const key = outcomeKey(messenger);
    select.dataset.outcomeKey = key;
    select.value = state.outcomes?.[key]?.status || "";
  }

  function syncFilterButton(unconfirmed) {
    const nativeFilter = document.querySelector("[role='button'][aria-label='Filters'], button[aria-label='Filters']");
    const host = nativeFilter?.parentElement?.parentElement;
    let button = document.getElementById("mbwa-filter");
    if (!host) return button?.remove();
    if (!button) {
      button = document.createElement("button");
      button.id = "mbwa-filter";
      button.type = "button";
      button.className = "mbwa-filter";
      button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12v8H9l-3.5 3v-3H4z"/><path d="m6 6 8 6"/></svg><span></span>`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        filterOn = !filterOn;
        sessionStorage.setItem(FILTER_KEY, filterOn ? "1" : "0");
        void runSync();
      });
      host.append(button);
    }
    button.querySelector("span").textContent = unconfirmed > 99 ? "99+" : String(unconfirmed);
    button.setAttribute("aria-label", `${filterOn ? "Show all conversations" : "Show Messenger conversations not confirmed on WhatsApp"}. ${unconfirmed} discovered.`);
    button.setAttribute("aria-pressed", String(filterOn));
  }

  function syncReviewQueue(rows, entries) {
    const slots = rows.map((item) => item.row.parentElement).filter(Boolean);
    const list = slots[0]?.parentElement;
    if (!list || !slots.every((slot) => slot.parentElement === list)) return;
    const scroller = list.parentElement;
    let queue = scroller.querySelector(":scope > .mbwa-review-queue");
    if (!filterOn) {
      list.style.display = list.dataset.mbwaOriginalDisplay || "";
      delete list.dataset.mbwaOriginalDisplay;
      queue?.remove();
      return;
    }
    if (queue?.contains(document.activeElement) && document.activeElement instanceof HTMLSelectElement) return;

    const firstRender = !queue;
    if (list.dataset.mbwaOriginalDisplay === undefined) list.dataset.mbwaOriginalDisplay = list.style.display || "";
    list.style.display = "none";
    if (!queue) {
      queue = document.createElement("div");
      queue.className = "mbwa-review-queue";
      scroller.append(queue);
    }
    queue.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "mbwa-review-empty";
      empty.textContent = "No unchecked Messenger leads have been discovered yet. Turn this filter off and scroll to index more chats.";
      queue.append(empty);
    }
    const selectedId = new URLSearchParams(location.search).get("selected_item_id");
    const selectedTitle = rows.find(({ row }) => row.getAttribute("aria-selected") === "true"
      || row.parentElement?.getAttribute("aria-selected") === "true")?.title;
    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "mbwa-review-item";
      const selected = entry.threadId ? entry.threadId === selectedId
        : selectedTitle && normalizedName(entry.title) === normalizedName(selectedTitle);
      if (selected) item.classList.add("is-selected");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "mbwa-review-open";
      open.setAttribute("aria-current", selected ? "true" : "false");
      const avatar = document.createElement("span");
      avatar.className = "mbwa-review-avatar";
      avatar.textContent = entry.title.trim().charAt(0).toLocaleUpperCase() || "?";
      const copy = document.createElement("span");
      copy.className = "mbwa-review-copy";
      const line = document.createElement("span");
      line.className = "mbwa-review-line";
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const preview = document.createElement("small");
      preview.textContent = entry.text.replace(/\s+/g, " ").replace(entry.title, "").trim().slice(0, 150) || "Messenger lead";
      const badge = document.createElement("em");
      const labels = {
        available: "Has WhatsApp", saved: "WA saved · unchecked", possible: "Same name only",
        unmatched: "Check WhatsApp", unknown: "Open to get phone"
      };
      badge.textContent = labels[entry.result.status] || "Needs review";
      badge.className = `mbwa-review-status mbwa-review-status--${entry.result.status}`;
      line.append(title, badge);
      copy.append(line, preview);
      open.append(avatar, copy);
      open.addEventListener("click", () => { void openReviewRecord(entry); });
      const select = document.createElement("select");
      select.className = "mbwa-review-outcome";
      select.setAttribute("aria-label", `Outcome for ${entry.title}`);
      select.innerHTML = `<option value="">Set outcome</option>${Object.entries(OUTCOMES)
        .map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}`;
      select.value = state.outcomes?.[outcomeKey(entry.messenger)]?.status || "";
      select.addEventListener("change", async () => {
        const key = outcomeKey(entry.messenger);
        if (select.value) state.outcomes[key] = { status: select.value, updatedAt: Date.now() };
        else delete state.outcomes[key];
        await storageSet({ [STATE_KEY]: state });
        quickToast(select.value ? `${OUTCOMES[select.value]} saved` : "Outcome cleared");
        await runSync();
      });
      item.append(open, select);
      queue.append(item);
    });
    if (firstRender) scroller.scrollTop = 0;
  }

  async function sync() {
    if (extensionContextInvalidated || syncing) return;
    syncing = true;
    try {
      const rows = conversationRows();
      const rowsChanged = rememberWhatsApp(rows);
      const activeChanged = rememberActiveConversation(rows);
      const reviewChanged = rememberReviewRows(rows);
      if (rowsChanged || activeChanged || reviewChanged) {
        await storageSet({ [INDEX_KEY]: index });
      }
      metaQueue = [];
      const whatsappRecords = [...Object.values(whatsappIndex), ...Object.values(index.whatsapp)];
      persistentQueue = reviewEntries(whatsappRecords).filter((item) => !item.resolved);
      rows.forEach((item) => {
        item.row.classList.remove("mbwa-filtered-out");
        if (item.channel !== "Messenger") {
          item.row.removeAttribute("data-mbwa-status");
          item.row.querySelector(".mbwa-status")?.remove();
          item.row.querySelector(".mbwa-outcome")?.remove();
          if (filterOn) item.row.classList.add("mbwa-filtered-out");
          return;
        }
        const messenger = messengerRecord(item.title, item.text);
        const result = metaMatchStatus(messenger, whatsappRecords);
        const resolved = result.status === "linked" || result.status === "available"
          || Boolean(state.outcomes?.[outcomeKey(messenger)]);
        setStatus(item, result, messenger);
        metaQueue.push({ ...item, messenger, result, resolved });
        if (filterOn && resolved) item.row.classList.add("mbwa-filtered-out");
      });
      syncFilterButton(persistentQueue.length);
      syncReviewQueue(rows, persistentQueue);
      syncPhoneActions();
    } finally {
      syncing = false;
    }
  }

  function runSync() {
    return sync().catch((error) => {
      if (!handleExtensionContextError(error)) console.error("WA Lead Folders Meta sync failed", error);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STATE_KEY]) state = { ...changes[STATE_KEY].newValue, outcomes: changes[STATE_KEY].newValue?.outcomes || {} };
    if (changes[INDEX_KEY]) index = normalizeIndex(changes[INDEX_KEY].newValue);
    if (changes[WA_INDEX_KEY]) whatsappIndex = normalizeWhatsAppIndex(changes[WA_INDEX_KEY].newValue);
    void runSync();
  });

  storageGet([STATE_KEY, INDEX_KEY, WA_INDEX_KEY]).then((stored) => {
    if (!stored || extensionContextInvalidated) return;
    state = { ...(stored[STATE_KEY] || state), outcomes: stored[STATE_KEY]?.outcomes || {} };
    index = normalizeIndex(stored[INDEX_KEY]);
    whatsappIndex = normalizeWhatsAppIndex(stored[WA_INDEX_KEY]);
    void runSync();
    refreshTimer = setInterval(runSync, 900);
  }).catch((error) => {
    if (!handleExtensionContextError(error)) console.error("WA Lead Folders Meta bootstrap failed", error);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("#mbwa-phone-bubble, .mbwa-phone")) closePhoneBubble();
    const row = event.target.closest?.("[role='presentation']");
    const title = row?.querySelector("[data-surface$='/lib:thread_title']")?.textContent?.trim();
    if (title && row.querySelector("img[alt='Messenger']")) {
      pendingMetaSelection = {
        title,
        previousThreadId: new URLSearchParams(location.search).get("selected_item_id")
      };
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePhoneBubble();
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement || target?.isContentEditable
      || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLocaleLowerCase() === "n") openNextMetaLead();
    if (event.key.toLocaleLowerCase() === "v") {
      const fields = metaLeadFields(document.querySelector("[role='region'][aria-label^='Message list container']")?.innerText || "");
      if (fields.phone) openPhone(fields.phone);
    }
  });
})();
