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
      "script,style,textarea,input,button,[contenteditable='true'],.mbwa-phone,.wa-qc-phone,.mbwa-row-line,#mbwa-card,.mbwa-review-queue"
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

  // ---- Presentation -------------------------------------------------------------------------

  const STATUS = {
    linked: { tone: "ok", label: "On WhatsApp", hint: "Same phone number as an existing WhatsApp conversation" },
    available: { tone: "ok", label: "Has WhatsApp", hint: "This phone opened in WhatsApp, but no conversation exists yet" },
    saved: { tone: "warn", label: "Saved · not confirmed", hint: "Saved by the extension but not rechecked in WhatsApp" },
    possible: { tone: "info", label: "Name match only", hint: "Only the profile name matches; the phone number isn't confirmed" },
    unmatched: { tone: "warn", label: "Check WhatsApp", hint: "Phone is known from the form but hasn't been checked in WhatsApp" },
    unknown: { tone: "muted", label: "No phone yet", hint: "Open this conversation so its form phone number can be read" }
  };
  const OUTCOME_TONES = { "has-wa": "ok", "messaged-wa": "ok", "no-wa": "muted", invalid: "bad", converted: "win" };
  const CHEVRON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>`;

  function statusFor(result) {
    const base = STATUS[result.status] || STATUS.unknown;
    const folder = result.status === "linked" && (folderFor(result.match) || result.match?.folderName);
    return { ...base, status: result.status, label: folder || base.label, folder };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function saveOutcome(key, value, advanceFrom) {
    if (value) state.outcomes[key] = { status: value, updatedAt: Date.now() };
    else delete state.outcomes[key];
    await storageSet({ [STATE_KEY]: state });
    quickToast(value ? `${OUTCOMES[value]} saved` : "Outcome cleared");
    await runSync();
    if (value && advanceFrom !== undefined) setTimeout(() => openNextMetaLead(advanceFrom), 120);
  }

  function closeOutcomeMenu() {
    const menu = document.getElementById("mbwa-outcome-menu");
    if (!menu) return;
    document.querySelector("[aria-controls='mbwa-outcome-menu'][aria-expanded='true']")?.setAttribute("aria-expanded", "false");
    menu.remove();
  }

  function openOutcomeMenu(anchor, key, advanceFrom) {
    const wasOpen = anchor.getAttribute("aria-expanded") === "true";
    closeOutcomeMenu();
    if (wasOpen) return;
    const current = state.outcomes?.[key]?.status || "";
    const menu = el("div");
    menu.id = "mbwa-outcome-menu";
    menu.setAttribute("role", "menu");
    const add = (value, label) => {
      const item = el("button", `mbwa-menu-item${value === current ? " is-current" : ""}`);
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(value === current));
      item.dataset.tone = OUTCOME_TONES[value] || "muted";
      item.append(el("i"), el("span", "", label));
      item.addEventListener("click", (event) => {
        stop(event);
        closeOutcomeMenu();
        void saveOutcome(key, value, advanceFrom);
      });
      menu.append(item);
    };
    Object.entries(OUTCOMES).forEach(([value, label]) => add(value, label));
    if (current) {
      menu.append(el("hr"));
      add("", "Clear outcome");
    }
    document.documentElement.append(menu);
    const box = anchor.getBoundingClientRect();
    const left = Math.min(box.left, innerWidth - menu.offsetWidth - 8);
    const below = box.bottom + 6 + menu.offsetHeight < innerHeight;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${below ? box.bottom + 6 : box.top - menu.offsetHeight - 6}px`;
    anchor.setAttribute("aria-expanded", "true");
    menu.querySelector(".is-current, .mbwa-menu-item")?.focus();
  }

  function statusChip(view) {
    const chip = el("span", `mbwa-chip mbwa-chip--${view.tone}`);
    chip.title = view.hint;
    if (view.status === "linked" || view.status === "available") chip.insertAdjacentHTML("afterbegin", WA_ICON);
    chip.append(el("span", "", view.label));
    return chip;
  }

  function outcomeButton(key, name, advanceFrom) {
    const status = state.outcomes?.[key]?.status || "";
    const button = el("button", `mbwa-outcome${status ? " is-set" : ""}`);
    button.type = "button";
    button.dataset.tone = OUTCOME_TONES[status] || "muted";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-controls", "mbwa-outcome-menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", `Outcome for ${name}: ${status ? OUTCOMES[status] : "not set"}`);
    button.append(el("span", "", status ? OUTCOMES[status] : "Outcome"));
    button.insertAdjacentHTML("beforeend", CHEVRON);
    button.addEventListener("click", (event) => {
      stop(event);
      openOutcomeMenu(button, key, advanceFrom);
    });
    return button;
  }

  function whatsAppButton(phone) {
    const button = el("button", "mbwa-wa-button");
    button.type = "button";
    button.title = `Message ${phone} on WhatsApp (V)`;
    button.setAttribute("aria-label", `Message ${phone} on WhatsApp`);
    button.innerHTML = WA_ICON;
    button.addEventListener("click", (event) => {
      stop(event);
      openPhone(phone);
    });
    return button;
  }

  // Status, outcome and a WhatsApp shortcut on their own line, so the name keeps its full width.
  function leadLine({ view, key, name, phone, advanceFrom }) {
    const line = el("div", "mbwa-row-line");
    line.append(statusChip(view), outcomeButton(key, name, advanceFrom));
    if (phone) line.append(whatsAppButton(phone));
    line.addEventListener("click", (event) => event.stopPropagation());
    return line;
  }

  // The first ancestor of the title that stacks other lines (the preview) below it.
  function textColumn(item) {
    let node = item.titleSurface;
    while (node.parentElement && node.parentElement !== item.row) {
      const parent = node.parentElement;
      const bottom = node.getBoundingClientRect().bottom;
      if ([...parent.children].some((child) => child !== node && !child.classList.contains("mbwa-row-line")
        && child.getBoundingClientRect().top >= bottom - 2 && child.textContent.trim())) return parent;
      node = parent;
    }
    return null;
  }

  function syncRowLine(item, result, messenger) {
    const view = statusFor(result);
    const key = outcomeKey(messenger);
    item.row.dataset.mbwaStatus = result.status;
    const signature = [view.status, view.label, key, state.outcomes?.[key]?.status || "", messenger.phone || ""].join("|");
    let line = item.row.querySelector(".mbwa-row-line");
    if (line?.dataset.signature === signature) return;
    const column = line?.parentElement || textColumn(item);
    if (!column) return;
    const next = leadLine({ view, key, name: messenger.name, phone: messenger.phone, advanceFrom: item.row });
    next.dataset.signature = signature;
    if (line) line.replaceWith(next);
    else column.append(next);
  }

  function syncFilterButton(unconfirmed) {
    const nativeFilter = document.querySelector("[role='button'][aria-label='Filters'], button[aria-label='Filters']");
    const host = nativeFilter?.parentElement?.parentElement;
    let button = document.getElementById("mbwa-filter");
    if (!host) return button?.remove();
    if (!button) {
      button = el("button", "mbwa-filter");
      button.id = "mbwa-filter";
      button.type = "button";
      button.innerHTML = `${WA_ICON}<span>To check</span><b></b>`;
      button.addEventListener("click", (event) => {
        stop(event);
        filterOn = !filterOn;
        sessionStorage.setItem(FILTER_KEY, filterOn ? "1" : "0");
        void runSync();
      });
      host.append(button);
    }
    button.querySelector("b").textContent = unconfirmed > 999 ? "999+" : String(unconfirmed);
    button.title = filterOn ? "Back to all conversations"
      : "Messenger leads not yet confirmed on WhatsApp, kept even after Meta unloads them";
    button.setAttribute("aria-label", `${filterOn ? "Show all conversations" : "Show Messenger leads to check on WhatsApp"}. ${unconfirmed} to check.`);
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
    // Don't rebuild under the user while they're choosing an outcome.
    if (queue?.contains(document.activeElement) || document.getElementById("mbwa-outcome-menu")) return;

    const firstRender = !queue;
    if (list.dataset.mbwaOriginalDisplay === undefined) list.dataset.mbwaOriginalDisplay = list.style.display || "";
    list.style.display = "none";
    if (!queue) {
      queue = el("div", "mbwa-review-queue");
      scroller.append(queue);
    }
    const selectedId = new URLSearchParams(location.search).get("selected_item_id");
    const selectedTitle = rows.find(({ row }) => row.getAttribute("aria-selected") === "true"
      || row.parentElement?.getAttribute("aria-selected") === "true")?.title;
    const signature = JSON.stringify([selectedId, selectedTitle, entries.map((entry) => [entry.key, entry.result.status,
      entry.messenger.phone, state.outcomes?.[outcomeKey(entry.messenger)]?.status])]);
    if (queue.dataset.signature === signature) return;
    queue.dataset.signature = signature;
    queue.replaceChildren();

    const header = el("div", "mbwa-review-header");
    const heading = el("div");
    heading.append(el("strong", "", `${entries.length} to check on WhatsApp`),
      el("small", "", "N next lead · V open phone in WhatsApp"));
    const exit = el("button", "mbwa-review-exit", "Show all");
    exit.type = "button";
    exit.addEventListener("click", () => {
      filterOn = false;
      sessionStorage.setItem(FILTER_KEY, "0");
      void runSync();
    });
    header.append(heading, exit);
    queue.append(header);

    if (!entries.length) {
      queue.append(el("p", "mbwa-review-empty",
        "Nothing left to check. Turn this filter off and scroll Meta's list to discover more leads."));
    }
    entries.forEach((entry) => {
      const selected = entry.threadId ? entry.threadId === selectedId
        : selectedTitle && normalizedName(entry.title) === normalizedName(selectedTitle);
      const item = el("div", `mbwa-review-item${selected ? " is-selected" : ""}`);
      const open = el("button", "mbwa-review-open");
      open.type = "button";
      open.setAttribute("aria-current", selected ? "true" : "false");
      const copy = el("span", "mbwa-review-copy");
      const preview = entry.text.replace(/\s+/g, " ").replace(entry.title, "").trim().slice(0, 150) || "Messenger lead";
      copy.append(el("strong", "", entry.title), el("small", "", preview));
      open.append(el("span", "mbwa-review-avatar", entry.title.trim().charAt(0).toLocaleUpperCase() || "?"), copy);
      open.addEventListener("click", () => { void openReviewRecord(entry); });
      item.append(open, leadLine({
        view: statusFor(entry.result),
        key: outcomeKey(entry.messenger),
        name: entry.title,
        phone: entry.messenger.phone
      }));
      queue.append(item);
    });
    if (firstRender) scroller.scrollTop = 0;
  }

  // ---- WhatsApp card in the contact panel ---------------------------------------------------

  function sidebarSection() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.trim() !== "About") continue;
      let section = node.parentElement;
      if (!section || section.closest("#mbwa-card") || section.getBoundingClientRect().left < innerWidth * .55) continue;
      // Climb to the About block, stopping before the column that also holds the other sections.
      while (section.parentElement && !/Labels|Notes|Outcomes|Facebook profile/.test(section.parentElement.innerText || "")) {
        section = section.parentElement;
      }
      return section;
    }
    return null;
  }

  function activeLead(rows, whatsappRecords) {
    const params = new URLSearchParams(location.search);
    const threadType = params.get("thread_type");
    if (!params.get("selected_item_id") || !threadType) return null;
    const region = document.querySelector("[role='region'][aria-label^='Message list container']");
    const fields = metaLeadFields(region?.innerText || "");
    const selected = rows.find(({ row }) => row.getAttribute("aria-selected") === "true"
      || row.parentElement?.getAttribute("aria-selected") === "true");
    if (threadType !== "FB_MESSAGE") {
      return { channel: "whatsapp", name: fields.fullName || selected?.title || "", phone: fields.phone || null };
    }
    const title = selected?.title || pendingMetaSelection?.title || fields.fullName || "";
    const found = messengerRecord(title, selected?.text || "");
    const messenger = { ...found, name: fields.fullName || found.name || title, phone: fields.phone || found.phone || null };
    return { channel: "messenger", name: messenger.name, phone: messenger.phone, messenger,
      result: metaMatchStatus(messenger, whatsappRecords) };
  }

  function syncSideCard(lead) {
    let card = document.getElementById("mbwa-card");
    const anchor = lead && sidebarSection();
    if (!lead || !anchor) return card?.remove();
    const key = lead.messenger ? outcomeKey(lead.messenger) : null;
    const signature = JSON.stringify([lead.channel, lead.name, lead.phone, lead.result?.status,
      lead.result && statusFor(lead.result).label, key && state.outcomes?.[key]?.status]);
    if (card?.dataset.signature === signature && card.nextElementSibling === anchor) return;
    card?.remove();
    card = el("section", "mbwa-card");
    card.id = "mbwa-card";
    card.dataset.signature = signature;
    card.setAttribute("aria-label", "WhatsApp");

    const head = el("div", "mbwa-card-head");
    head.append(el("h3", "", "WhatsApp"));
    if (lead.result) head.append(statusChip(statusFor(lead.result)));
    card.append(head);

    if (lead.phone) {
      const phoneRow = el("div", "mbwa-card-phone");
      phoneRow.append(el("span", "", lead.phone));
      const actions = el("div", "mbwa-card-actions");
      const action = (label, className, handler) => {
        const button = el("button", className, label);
        button.type = "button";
        button.addEventListener("click", handler);
        actions.append(button);
      };
      action("Message", "is-primary", () => openPhone(lead.phone));
      action("Call", "", () => openPhone(lead.phone, "call"));
      action("Copy", "", () => copyPhone(lead.phone));
      card.append(phoneRow, actions);
    } else {
      card.append(el("p", "mbwa-card-note", "No phone number in this conversation yet. It appears once the lead form is answered."));
    }

    if (lead.result) {
      const view = statusFor(lead.result);
      card.append(el("p", "mbwa-card-note", view.folder ? `In your WhatsApp group ${view.folder}.` : view.hint + "."));
      const outcomes = el("div", "mbwa-card-outcomes");
      outcomes.setAttribute("role", "radiogroup");
      outcomes.setAttribute("aria-label", "Outcome");
      const current = state.outcomes?.[key]?.status || "";
      Object.entries(OUTCOMES).forEach(([value, label]) => {
        const button = el("button", value === current ? "is-current" : "", label);
        button.type = "button";
        button.dataset.tone = OUTCOME_TONES[value];
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(value === current));
        button.addEventListener("click", () => void saveOutcome(key, value === current ? "" : value,
          value === current ? undefined : null));
        outcomes.append(button);
      });
      card.append(el("span", "mbwa-card-label", "Outcome"), outcomes);
    }
    card.append(el("small", "mbwa-card-keys", "N next lead · V open phone in WhatsApp"));
    anchor.before(card);
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
          item.row.querySelector(".mbwa-row-line")?.remove();
          if (filterOn) item.row.classList.add("mbwa-filtered-out");
          return;
        }
        const messenger = messengerRecord(item.title, item.text);
        const result = metaMatchStatus(messenger, whatsappRecords);
        const resolved = result.status === "linked" || result.status === "available"
          || Boolean(state.outcomes?.[outcomeKey(messenger)]);
        syncRowLine(item, result, messenger);
        metaQueue.push({ ...item, messenger, result, resolved });
        if (filterOn && resolved) item.row.classList.add("mbwa-filtered-out");
      });
      syncFilterButton(persistentQueue.length);
      syncReviewQueue(rows, persistentQueue);
      syncSideCard(activeLead(rows, whatsappRecords));
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
    if (!event.target.closest?.("#mbwa-outcome-menu, .mbwa-outcome")) closeOutcomeMenu();
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
    if (event.key === "Escape") {
      closePhoneBubble();
      closeOutcomeMenu();
    }
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
