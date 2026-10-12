(() => {
  const STORAGE_KEY = "waLeadFoldersState";
  const WA_INDEX_KEY = "waLeadFoldersWhatsAppIndex";
  const QUICK_OPEN_KEY = "waLeadFoldersQuickOpened";
  const DEFAULT_FOLDERS = [
    { id: "wholesale", name: "Wholesalers", color: "#f6a723" },
    { id: "retail", name: "Retailers", color: "#45b6a8" },
    { id: "follow-up", name: "Follow up", color: "#7c8df2" },
    { id: "customer", name: "Converted", color: "#48a868" }
  ];
  const FOLDER_COLORS = [
    "#f6a723", "#45b6a8", "#7c8df2", "#48a868",
    "#e16b5b", "#a77bd8", "#4e9fd1", "#d58e57",
    "#9aa3ad", "#9a7b73"
  ];
  const DEFAULT_UNASSIGNED_COLOR = "#5c6563";
  const UNKNOWN_COLOR = "#9aa3ad";

  let state;
  let root;
  let panel;
  let launcher;
  let whatsappIndex = {};
  let pendingQuickOpen = null;
  let refreshTimer;
  let extensionContextInvalidated = false;
  let queueMode = "all";
  let triageMode = false;
  const observedOutgoing = new Map();
  const INLINE_UNASSIGNED_ID = "__unassigned__";
  const INLINE_TAB_HEIGHT = 48;
  const INLINE_MISSING_ROW_HEIGHT = 72;
  let activeInlineTabId = null;
  const NativeLists = globalThis.WALeadNativeLists;
  let lastNativeActive;
  let nativeSyncBusy = false;
  const nativeSyncAttempts = new Set();
  let batchSync = null;

  function storageApiAvailable() {
    const storage = typeof chrome !== "undefined" ? chrome.storage?.local : null;
    return Boolean(storage
      && typeof storage.get === "function"
      && typeof storage.set === "function");
  }

  function stopAfterStorageUnavailable() {
    extensionContextInvalidated = true;
    if (refreshTimer) clearInterval(refreshTimer);
  }

  function handleExtensionContextError(error) {
    if (!/Extension context invalidated|Cannot read properties of undefined \(reading '(?:local|get|set)'\)/i
      .test(String(error?.message || error))) return false;
    stopAfterStorageUnavailable();
    return true;
  }

  async function storageGet(keys) {
    if (!storageApiAvailable()) {
      stopAfterStorageUnavailable();
      return null;
    }
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      if (handleExtensionContextError(error)) return null;
      throw error;
    }
  }

  async function storageSet(value) {
    if (!storageApiAvailable()) {
      stopAfterStorageUnavailable();
      return false;
    }
    try {
      await chrome.storage.local.set(value);
      return true;
    } catch (error) {
      if (handleExtensionContextError(error)) return false;
      throw error;
    }
  }

  let ignoreStorageEcho = 0;
  let persistTimer = 0;
  let persistWaiters = [];

  function persistState() {
    if (!state || extensionContextInvalidated) return Promise.resolve(false);
    return new Promise((resolve) => {
      persistWaiters.push(resolve);
      if (persistTimer) return;
      persistTimer = setTimeout(async () => {
        persistTimer = 0;
        const waiters = persistWaiters.splice(0);
        ignoreStorageEcho += 1;
        const ok = await storageSet({ [STORAGE_KEY]: state });
        setTimeout(() => { ignoreStorageEcho = Math.max(0, ignoreStorageEcho - 1); }, 40);
        waiters.forEach((done) => done(ok));
      }, 0);
    });
  }

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);

  function normalizeFolder(folder) {
    if (!folder || typeof folder.id !== "string" || typeof folder.name !== "string") return null;
    return {
      id: folder.id,
      name: folder.name,
      color: folder.id === "unknown" && (!folder.color || /^#(?:87938f|25d366)$/i.test(folder.color))
        ? UNKNOWN_COLOR
        : (typeof folder.color === "string" && folder.color ? folder.color : "#25d366"),
      hidden: Boolean(folder.hidden),
      nativeList: typeof folder.nativeList === "string" && folder.nativeList.trim()
        ? folder.nativeList.trim().slice(0, 60) : null
    };
  }

  function normalizeState(value = {}) {
    const legacyReplies = value.quickReplies && typeof value.quickReplies === "object" && !Array.isArray(value.quickReplies)
      ? value.quickReplies : {};
    const replySequences = value.replySequences && typeof value.replySequences === "object" && !Array.isArray(value.replySequences)
      ? value.replySequences : Object.fromEntries(Object.entries(legacyReplies).map(([id, reply]) => [id, [reply]]));
    const folders = WALeadFoldersClassifier.ensureSystemFolders(Array.isArray(value.folders)
      ? value.folders.map(normalizeFolder).filter(Boolean)
      : DEFAULT_FOLDERS.map((folder) => ({ ...folder, hidden: false })));
    return {
      folders,
      contacts: value.contacts && typeof value.contacts === "object" ? value.contacts : {},
      quickReplies: legacyReplies,
      replySequences: Object.fromEntries(Object.entries(replySequences)
        .map(([id, replies]) => [id, (Array.isArray(replies) ? replies : [replies])
          .map((reply) => String(reply || "").trim().slice(0, 1000)).filter(Boolean).slice(0, 3)])),
      folderRules: value.folderRules && typeof value.folderRules === "object" && !Array.isArray(value.folderRules)
        ? Object.fromEntries(Object.entries(value.folderRules).map(([id, phrases]) => [id,
          (Array.isArray(phrases) ? phrases : []).map((phrase) => String(phrase).trim()).filter(Boolean).slice(0, 20)])) : {},
      outcomes: value.outcomes && typeof value.outcomes === "object" && !Array.isArray(value.outcomes) ? value.outcomes : {},
      leadScores: value.leadScores && typeof value.leadScores === "object" && !Array.isArray(value.leadScores)
        ? value.leadScores : {},
      leadSuggestions: value.leadSuggestions && typeof value.leadSuggestions === "object"
        && !Array.isArray(value.leadSuggestions) ? value.leadSuggestions : {},
      chatBindings: value.chatBindings && typeof value.chatBindings === "object"
        && !Array.isArray(value.chatBindings)
        ? Object.fromEntries(Object.entries(value.chatBindings)
          .filter(([key, id]) => key && typeof id === "string"))
        : {},
      nativeListNames: Array.isArray(value.nativeListNames)
        ? [...new Set(value.nativeListNames.filter((name) => typeof name === "string" && name.trim()))].slice(0, 50)
        : [],
      groupingEnabled: value.groupingEnabled ?? true,
      autoFollowUpHours: Number.isFinite(Number(value.autoFollowUpHours))
        ? Math.min(720, Math.max(0, Number(value.autoFollowUpHours)))
        : 24,
      lastBulkUndo: Array.isArray(value.lastBulkUndo) ? value.lastBulkUndo : null
    };
  }

  const visibleFolders = () => state.folders.filter((folder) => !folder.hidden);
  const hiddenFolders = () => state.folders.filter((folder) => folder.hidden);
  // Hide only removes folders from the chat list — they stay valid assignment and suggestion targets.
  const foldersForAssignment = () => state.folders;
  const folderSignature = () => state.folders
    .map((folder) => `${folder.id}:${folder.name}:${folder.hidden ? 1 : 0}:${folder.nativeList || ""}`).join(",");
  const ROW_HIDDEN_CHIP_LIMIT = 3;

  const isDue = (contact) => Boolean(contact?.remindAt && Date.parse(contact.remindAt) <= Date.now());
  const localDateTime = (time) => new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const automaticReminder = (contact) => Object.hasOwn(contact || {}, "remindAt")
    ? contact.remindAt
    : state.autoFollowUpHours ? localDateTime(Date.now() + state.autoFollowUpHours * 3600000) : null;

  const structuredFields = (text) => WALeadFoldersClassifier.structuredLeadFields(text || "");
  const assignmentSource = (source) => source === "auto" ? "Auto rule" : source === "manual" ? "Manual"
    : source === "whatsapp" ? "WhatsApp list" : "Legacy";

  function scheduleUnscheduledContacts() {
    const contacts = Object.values(state.contacts).filter((contact) => !Object.hasOwn(contact, "remindAt"));
    contacts.forEach((contact) => {
      contact.remindAt = automaticReminder(contact);
      contact.reminderSetAt = contact.remindAt ? Date.now() : null;
    });
    return contacts.length > 0;
  }

  async function loadState() {
    const stored = await storageGet([STORAGE_KEY, WA_INDEX_KEY, QUICK_OPEN_KEY]);
    if (!stored) return null;
    const previousFolders = new Map((stored[STORAGE_KEY]?.folders || [])
      .map((folder) => [folder?.id, folder?.color]));
    state = normalizeState(stored[STORAGE_KEY]);
    whatsappIndex = stored[WA_INDEX_KEY] && typeof stored[WA_INDEX_KEY] === "object"
      ? stored[WA_INDEX_KEY] : {};
    pendingQuickOpen = latestQuickOpen(stored[QUICK_OPEN_KEY]);
    const foldersChanged = state.folders.some((folder) => !previousFolders.has(folder.id)
      || previousFolders.get(folder.id) !== folder.color);
    if (scheduleUnscheduledContacts() || foldersChanged) await persistState();
    return state;
  }

  function saveState() {
    syncInlineFolders();
    return persistState();
  }

  function contactId(name) {
    const phone = WALeadFoldersClassifier.normalizedPhone(name)
      || WALeadFoldersClassifier.phoneInText(name);
    if (phone) return `phone:${phone.replace(/\D/g, "")}`;
    const username = WALeadFoldersClassifier.normalizedUsername(name);
    if (username) return `username:${username}`;
    const digits = String(name || "").replace(/\D/g, "");
    return digits.length >= 8 ? `phone:${digits}` : `name:${String(name || "").trim().toLocaleLowerCase()}`;
  }

  function stableRowKey(row) {
    if (!row) return null;
    const testid = row.getAttribute("data-testid") || "";
    const dataId = row.getAttribute("data-id") || "";
    const token = dataId || testid.replace(/^list-item-/, "");
    if (!token || /^\d{1,3}$/.test(token)) return null;
    if (WALeadFoldersClassifier.phoneInText(token) || /@/.test(token) || token.length >= 8) return token;
    return testid.length > 14 ? testid : null;
  }

  function describeVisibleChat(name, row = null, extra = {}) {
    const blob = [name, extra.text, extra.subtitle, row?.getAttribute("data-testid"),
      row?.getAttribute("data-id"), row?.getAttribute("aria-label")].filter(Boolean).join(" ");
    const phone = extra.phone
      || WALeadFoldersClassifier.normalizedPhone(name)
      || WALeadFoldersClassifier.phoneInText(blob);
    const username = extra.username
      || WALeadFoldersClassifier.normalizedUsername(name)
      || WALeadFoldersClassifier.usernamesIn(blob)[0];
    const id = phone ? `phone:${phone.replace(/\D/g, "")}`
      : username ? `username:${username}`
        : contactId(name);
    return { id, name, phone: phone || null, username: username || null, rowKey: stableRowKey(row), jid: extra.jid || null };
  }

  function rememberChatBinding(chat, contact) {
    if (!contact) return null;
    let changed = false;
    if (chat?.jid && (contact.jid !== chat.jid || state.chatBindings[`jid:${chat.jid}`] !== contact.id)) {
      contact.jid = chat.jid;
      state.chatBindings[`jid:${chat.jid}`] = contact.id;
      changed = true;
    }
    if (chat?.rowKey && state.chatBindings[chat.rowKey] !== contact.id) {
      state.chatBindings[chat.rowKey] = contact.id;
      changed = true;
    }
    const aliases = new Set(contact.aliases || []);
    const size = aliases.size;
    if (chat?.name) aliases.add(chat.name);
    if (chat?.username) aliases.add(`@${chat.username}`);
    if (aliases.size !== size) {
      contact.aliases = [...aliases];
      changed = true;
    }
    if (chat?.username && !contact.username) {
      contact.username = chat.username;
      changed = true;
    }
    if (chat?.phone && !contact.phone) {
      contact.phone = chat.phone;
      changed = true;
    }
    if (chat?.name && contact.name !== chat.name && !WALeadFoldersClassifier.normalizedPhone(chat.name)
      && (!contact.name || WALeadFoldersClassifier.normalizedPhone(contact.name))) {
      contact.name = chat.name.replace(/^@/, "") || contact.name;
      changed = true;
    }
    if (changed) void persistState();
    return contact;
  }

  function resolveSavedContact(chat) {
    // WhatsApp's own chat id is the strongest identity: names change, phones can be hidden.
    const jidBound = chat?.jid ? state.contacts[state.chatBindings[`jid:${chat.jid}`]] : null;
    if (jidBound) return rememberChatBinding(chat, jidBound);
    const matched = WALeadFoldersClassifier.matchingContact(state.contacts, chat, chat?.phone);
    const boundId = chat?.rowKey ? state.chatBindings[chat.rowKey] : null;
    if (boundId && !state.contacts[boundId]) delete state.chatBindings[chat.rowKey];
    const bound = !matched && boundId ? state.contacts[boundId] : null;
    return rememberChatBinding(chat, matched || bound || null);
  }

  function insightKeys(chat) {
    const keys = new Set();
    if (chat?.id) keys.add(chat.id);
    const phone = WALeadFoldersClassifier.normalizedPhone(chat?.phone)
      || WALeadFoldersClassifier.normalizedPhone(chat?.name)
      || (chat?.id?.startsWith("phone:")
        ? WALeadFoldersClassifier.normalizedPhone(chat.id.slice(6)) : null);
    if (phone) keys.add(`phone:${phone.replace(/\D/g, "")}`);
    const username = chat?.username || WALeadFoldersClassifier.normalizedUsername(chat?.name)
      || (chat?.id?.startsWith("username:") ? chat.id.slice(9) : null);
    if (username) keys.add(`username:${username}`);
    return [...keys];
  }

  function storedSuggestion(chat) {
    for (const key of insightKeys(chat)) {
      if (state.leadSuggestions[key]?.folderId) return state.leadSuggestions[key];
    }
    return null;
  }

  function storedScore(chat) {
    for (const key of insightKeys(chat)) {
      if (state.leadScores[key]) return state.leadScores[key];
    }
    return null;
  }

  function persistLeadInsight(chat, { score, suggestion } = {}) {
    const keys = insightKeys(chat);
    if (!keys.length) return;
    let changed = false;
    keys.forEach((key) => {
      if (score && JSON.stringify(state.leadScores[key]) !== JSON.stringify(score)) {
        state.leadScores[key] = score;
        changed = true;
      }
      if (suggestion && JSON.stringify(state.leadSuggestions[key]) !== JSON.stringify(suggestion)) {
        state.leadSuggestions[key] = suggestion;
        changed = true;
      }
    });
    if (changed) void persistState();
  }

  function forgetLeadSuggestion(chat) {
    let changed = false;
    insightKeys(chat).forEach((key) => {
      if (Object.hasOwn(state.leadSuggestions, key)) {
        delete state.leadSuggestions[key];
        changed = true;
      }
    });
    if (changed) void persistState();
  }

  function resolveLeadInsight(chat, text, contact) {
    const liveScore = WALeadFoldersClassifier.scoreLead(text || "");
    const score = WALeadFoldersClassifier.rememberedLeadScore(liveScore, storedScore(chat));
    if (contact?.folderId) {
      forgetLeadSuggestion(chat);
      if (score) persistLeadInsight(chat, { score });
      return { suggestion: null, score };
    }
    const liveSuggestion = WALeadFoldersClassifier.classifyLead(
      text || "", foldersForAssignment(), state.folderRules
    );
    const suggestion = WALeadFoldersClassifier.rememberedLeadSuggestion(
      liveSuggestion, storedSuggestion(chat), foldersForAssignment()
    );
    persistLeadInsight(chat, { score, suggestion });
    return { suggestion, score };
  }

  function latestQuickOpen(value) {
    const latest = Object.entries(value || {}).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    return latest && Date.now() - Number(latest[1]) < 2 * 60 * 1000
      ? { phone: WALeadFoldersClassifier.normalizedPhone(latest[0]), openedAt: Number(latest[1]) } : null;
  }

  function activeChat() {
    const header = document.querySelector("#main header");
    if (!header) return null;

    const name = header.querySelector("[data-testid='conversation-info-header-chat-title']")
      ?.textContent?.trim()
      || document.querySelector("#side [aria-selected='true'] span[title]")
        ?.getAttribute("title")?.trim();
    if (!name) return null;
    const selectedRow = document.querySelector("#pane-side [data-testid^='list-item-'][aria-selected='true']")
      || document.querySelector("#pane-side [aria-selected='true']")?.closest("[data-testid^='list-item-']");
    const bits = [...header.querySelectorAll("span[title], [data-testid='conversation-info-header'] span")]
      .map((element) => element.getAttribute("title") || element.textContent?.trim())
      .filter(Boolean);
    const conversation = visibleConversationText();
    const jid = activeChatJid();
    return describeVisibleChat(name, selectedRow, {
      text: [...bits, conversation].join("\n"),
      jid,
      phone: WALeadFoldersClassifier.jidPhone(jid)
        || WALeadFoldersClassifier.phoneInText(conversation) || pendingQuickOpen?.phone || null
    });
  }

  function activeChatJid() {
    for (const element of document.querySelectorAll("#main [data-id]")) {
      const jid = WALeadFoldersClassifier.chatJidFromMessageId(element.getAttribute("data-id"));
      if (jid) return jid;
    }
    return null;
  }

  function savedContact(chat) {
    return resolveSavedContact(chat);
  }

  function nativeChatRowText(row) {
    if (!row?.cloneNode) return row?.textContent || "";
    const clone = row.cloneNode(true);
    clone.querySelectorAll(".walf-row-groups").forEach((element) => element.remove());
    return clone.textContent || "";
  }

  function repairStatusContact(chat) {
    if (!chat || state.contacts[chat.id]) return;
    const broken = Object.values(state.contacts)
      .filter((contact) => /^(last seen|online$|typing(?:…|\.\.\.)?$)/i.test(contact.name));
    if (broken.length !== 1) return;

    delete state.contacts[broken[0].id];
    state.contacts[chat.id] = { ...broken[0], ...chat, updatedAt: Date.now() };
    void saveState();
  }

  function visibleConversationText() {
    const panel = document.querySelector("#main [data-testid='conversation-panel-body']")
      || document.querySelector("#main");
    if (!panel) return "";
    const elements = [...panel.querySelectorAll(
      "[data-pre-plain-text], .copyable-text, .selectable-text, [data-testid='msg-text']"
    )].slice(-80);
    return [...new Set(elements.map((element) => {
      const stamped = element.getAttribute("data-pre-plain-text");
      return [stamped, element.textContent].filter(Boolean).join("\n").trim();
    }).filter(Boolean))].join("\n");
  }

  function completeFollowUpFromOutgoing() {
    const chat = activeChat();
    const contact = savedContact(chat);
    if (!chat || !contact?.remindAt) return false;
    const outgoing = [...document.querySelectorAll("#main [data-testid='msg-container']")]
      .filter((message) => message.querySelector("[data-testid='msg-meta'] [aria-label]"));
    const message = outgoing[outgoing.length - 1];
    if (!message) return false;
    const label = message.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") || "";
    const marker = `${label}|${message.textContent?.trim() || ""}`;
    const previousMarker = observedOutgoing.get(chat.id);
    observedOutgoing.set(chat.id, marker);
    const sentAt = WALeadFoldersClassifier.whatsAppMessageTime(label);
    const reminderSetAt = Number(contact.reminderSetAt || contact.updatedAt || contact.firstSeenAt);
    if (marker === previousMarker || (!previousMarker && (!sentAt || sentAt < reminderSetAt))) return false;
    contact.remindAt = null;
    contact.reminderSetAt = null;
    contact.followedUpAt = sentAt || Date.now();
    contact.updatedAt = Date.now();
    void persistState();
    return true;
  }

  function contactPhone(contact) {
    return WALeadFoldersClassifier.normalizedPhone(contact?.phone)
      || WALeadFoldersClassifier.jidPhone(contact?.jid)
      || WALeadFoldersClassifier.normalizedPhone(contact?.name)
      || (contact?.id?.startsWith("phone:")
        ? WALeadFoldersClassifier.normalizedPhone(contact.id.slice(6)) : null);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForValue(read, timeout) {
    const started = Date.now();
    for (;;) {
      const value = read();
      if (value) return value;
      if (Date.now() - started > timeout) return null;
      await sleep(100);
    }
  }

  const chatSearchBox = () => document.querySelector("#side [contenteditable='true'][role='textbox'], #side input[placeholder]");
  const chatSearchText = () => {
    const search = chatSearchBox();
    return (search?.value || search?.textContent || "").trim();
  };

  function setSearchQuery(search, query) {
    search.focus();
    if (search instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, query);
      search.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(search);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const applied = query ? document.execCommand("insertText", false, query) : document.execCommand("delete");
    if (!applied) {
      search.textContent = query;
      search.dispatchEvent(new InputEvent("input", { bubbles: true, data: query }));
    }
  }

  // WhatsApp rows and buttons often react to the pointer sequence rather than a bare click().
  function pressElement(element) {
    const options = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new PointerEvent("pointerdown", options));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new PointerEvent("pointerup", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.click();
  }

  function pressKey(element, key) {
    ["keydown", "keyup"].forEach((type) => element.dispatchEvent(new KeyboardEvent(type, {
      key, code: key, keyCode: key === "Enter" ? 13 : 27, which: key === "Enter" ? 13 : 27, bubbles: true, cancelable: true
    })));
  }

  // The ✕ inside the search field: icon-only and placed after the text box.
  function searchClearButton(search) {
    let node = search.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      const buttons = [...node.querySelectorAll("button, [role='button']")].filter((button) => !button.contains(search)
        && button.getClientRects().length && !button.closest("[class*='walf-']"));
      const labelled = buttons.find((button) => /cancel|clear|close/i
        .test(`${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`));
      if (labelled) return labelled;
      const trailingIcon = buttons.filter((button) => !button.textContent.trim()
        && (search.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)).pop();
      if (trailingIcon) return trailingIcon;
    }
    return null;
  }

  // Empties WhatsApp's search and waits until it really is empty, so the next query starts fresh.
  async function clearChatSearch() {
    if (!chatSearchBox() || !chatSearchText()) return true;
    const cancel = searchClearButton(chatSearchBox());
    if (cancel) pressElement(cancel);
    if (await waitForValue(() => !chatSearchText(), 800)) return true;
    if (chatSearchBox()) setSearchQuery(chatSearchBox(), "");
    if (await waitForValue(() => !chatSearchText(), 600)) return true;
    if (chatSearchBox()) pressKey(chatSearchBox(), "Escape");
    return Boolean(await waitForValue(() => !chatSearchText(), 600));
  }

  function searchResultRow(contact, directPhone) {
    const titles = [...document.querySelectorAll("#pane-side span[title]")]
      .filter((title) => !title.closest("[class*='walf-']"));
    const phoneMatch = directPhone && titles.find((title) => (
      WALeadFoldersClassifier.normalizedPhone(title.getAttribute("title")) === directPhone
    ));
    const normalizedContactName = WALeadFoldersClassifier.normalizedName(contact.name);
    const nameMatches = normalizedContactName
      ? titles.filter((title) => WALeadFoldersClassifier.normalizedName(title.getAttribute("title"))
        === normalizedContactName)
      : [];
    const exact = phoneMatch || (nameMatches.length === 1 ? nameMatches[0] : null);
    return exact?.closest("[role='row'], [role='listitem'], [role='gridcell'], [role='button']") || null;
  }

  const isOpenLead = (contact) => {
    const chat = activeChat();
    return Boolean(chat && savedContact(chat)?.id === contact.id);
  };

  // Resolves true once the lead's chat is open. `reload: false` never leaves the page.
  async function openSavedContact(contact, { reload = true } = {}) {
    const directPhone = contactPhone(contact);
    const search = chatSearchBox();
    const searchQueries = [...new Set([directPhone, contact.name].filter(Boolean))];
    const fallbackToDirect = () => {
      if (!directPhone || !reload) {
        if (reload) toast(`No WhatsApp result for ${contact.name}`);
        return false;
      }
      location.assign(WALeadFoldersClassifier.whatsAppWebUrl(directPhone));
      return true;
    };
    if (!search || !searchQueries.length) return fallbackToDirect();
    // A WhatsApp list filter could hide the lead from search results.
    if (NativeLists.activeListName()) {
      await NativeLists.activateAll();
      await sleep(200);
    }
    if (isOpenLead(contact)) return true;
    let clicked = false;
    for (const query of searchQueries) {
      await clearChatSearch();
      setSearchQuery(chatSearchBox() || search, query);
      const row = await waitForValue(() => searchResultRow(contact, directPhone), 3000);
      if (!row) continue;
      clicked = true;
      pressElement(row.querySelector("[data-testid='cell-frame-container']") || row);
      let opened = await waitForValue(() => isOpenLead(contact), 2500);
      if (!opened && chatSearchBox()) {
        // Enter in WhatsApp's search opens the top result.
        pressKey(chatSearchBox(), "Enter");
        opened = await waitForValue(() => isOpenLead(contact), 2000);
      }
      await clearChatSearch();
      if (opened) return true;
    }
    await clearChatSearch();
    // A row was clicked but couldn't be confirmed: never reload over a chat that may be open.
    if (clicked) return false;
    return fallbackToDirect();
  }

  async function syncWhatsAppIndex() {
    if (!state) return;
    let changed = false;
    const folders = new Map(state.folders.map((folder) => [folder.id, folder.name]));
    const remember = (aliases, record) => aliases.filter(Boolean).forEach((alias) => {
      const key = WALeadFoldersClassifier.normalizedName(alias);
      if (!key) return;
      const previous = whatsappIndex[key];
      const next = {
        name: record.name || previous?.name || alias,
        phone: record.phone || previous?.phone || null,
        folderId: record.folderId ?? previous?.folderId ?? null,
        folderName: record.folderName ?? previous?.folderName ?? null,
        hasWa: Boolean(record.hasWa || previous?.hasWa),
        conversation: Boolean(record.conversation || previous?.conversation)
      };
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        whatsappIndex[key] = next;
        changed = true;
      }
    });

    Object.values(state.contacts).forEach((contact) => remember([contact.name], {
      name: contact.name,
      phone: contactPhone(contact),
      folderId: contact.folderId,
      folderName: folders.get(contact.folderId) || null
    }));

    const search = document.querySelector("#side [contenteditable='true'][role='textbox'], #side input[placeholder]");
    const searching = Boolean((search?.value || search?.textContent || "").trim());
    document.querySelectorAll(
      "#pane-side [data-testid='chat-list'] [role='row'][data-testid^='list-item-'] [data-testid='cell-frame-title'] span[title]"
    ).forEach((title) => {
      const name = title.getAttribute("title")?.trim();
      if (!name) return;
      const row = title.closest("[data-testid^='list-item-']");
      const contact = savedContact(describeVisibleChat(name, row));
      remember([name], {
        name,
        phone: WALeadFoldersClassifier.normalizedPhone(name) || contactPhone(contact),
        folderId: contact?.folderId,
        folderName: folders.get(contact?.folderId) || null,
        hasWa: !searching,
        conversation: !searching
      });
    });

    const chat = activeChat();
    if (chat) {
      const leadMessage = [...document.querySelectorAll("#main [data-pre-plain-text], #main .selectable-text")]
        .map((element) => element.textContent?.trim()).find((text) => /Phone number:/i.test(text || ""));
      const fields = WALeadFoldersClassifier.metaLeadFields(leadMessage || "");
      const contact = savedContact(chat);
      const requestedPhone = WALeadFoldersClassifier.normalizedPhone(new URLSearchParams(location.search).get("phone"))
        || pendingQuickOpen?.phone;
      const phone = fields.phone || WALeadFoldersClassifier.normalizedPhone(chat.name) || contactPhone(contact) || requestedPhone;
      const conversation = Boolean(document.querySelector("#main [data-pre-plain-text]"));
      remember([chat.name, fields.fullName], {
        name: fields.fullName || chat.name,
        phone,
        folderId: contact?.folderId,
        folderName: folders.get(contact?.folderId) || null,
        hasWa: conversation || Boolean(requestedPhone && phone === requestedPhone),
        conversation
      });
      if (conversation && requestedPhone && phone === requestedPhone) pendingQuickOpen = null;
    }

    if (changed) await storageSet({ [WA_INDEX_KEY]: whatsappIndex });
  }

  function detectTheme() {
    const color = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    const dark = color && (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000 < 128;
    root.dataset.theme = dark ? "dark" : "light";
  }

  function positionUi() {
    const side = document.querySelector("#side");
    if (!side || !root) return;
    const box = side.getBoundingClientRect();
    const screen = document.querySelector("[data-testid='wa-web-main-screen']")?.getBoundingClientRect();
    root.style.setProperty("--walf-left", `${box.left}px`);
    root.style.setProperty("--walf-top", `${screen?.top ?? box.top}px`);
    root.style.setProperty("--walf-width", `${box.width}px`);
    root.style.setProperty("--walf-height", `${screen?.height ?? box.height}px`);
  }

  function syncLauncherRail() {
    if (!launcher) return;
    const anchor = document.querySelector("button[aria-label='Advertise']")
      || document.querySelector("button[aria-label='Tools']");
    let rail = anchor?.parentElement;
    while (rail && rail !== document.body && ![...rail.children].some((child) => child.tagName === "HR")) {
      rail = rail.parentElement;
    }
    if (!rail || rail === document.body) return;

    let anchorItem = anchor;
    while (anchorItem.parentElement !== rail) anchorItem = anchorItem.parentElement;
    let separator = document.getElementById("walf-rail-separator");
    let slot = document.getElementById("walf-rail-slot");
    if (!separator) {
      separator = rail.querySelector(":scope > hr")?.cloneNode(false) || document.createElement("hr");
      separator.id = "walf-rail-separator";
    }
    if (!slot) {
      slot = document.createElement("div");
      slot.id = "walf-rail-slot";
    }
    if (separator.previousElementSibling !== anchorItem || slot.previousElementSibling !== separator) {
      anchorItem.after(separator, slot);
    }
    if (!slot.contains(launcher)) slot.append(launcher);
  }

  function toast(message) {
    const element = root.querySelector(".walf-toast");
    element.textContent = message;
    element.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("is-visible"), 2200);
  }

  function openFormDialog({ title, description = "", confirmLabel = "Save", danger = false, fields = [], validate }) {
    root.querySelector(".walf-dialog")?.remove();
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "walf-dialog";
      dialog.innerHTML = `
        <form method="dialog">
          <header><div><small>WA LEAD FOLDERS</small><h3>${escapeHtml(title)}</h3></div><button type="button" data-dialog-cancel aria-label="Close">×</button></header>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          <div class="walf-dialog-fields"></div>
          <div class="walf-dialog-error" role="alert" hidden></div>
          <footer><button type="button" data-dialog-cancel>Cancel</button><button type="submit" class="${danger ? "is-danger" : "is-primary"}">${escapeHtml(confirmLabel)}</button></footer>
        </form>`;
      const fieldsRoot = dialog.querySelector(".walf-dialog-fields");
      fields.forEach((field) => {
        const label = document.createElement("label");
        label.innerHTML = `<span>${escapeHtml(field.label)}</span>${field.hint ? `<em>${escapeHtml(field.hint)}</em>` : ""}`;
        if (field.type === "color") {
          label.classList.add("is-color");
          const wrap = document.createElement("div");
          wrap.className = "walf-color-field";
          const hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = field.name;
          hidden.value = /^#[0-9a-f]{3,8}$/i.test(field.value || "") ? field.value : UNKNOWN_COLOR;
          const picker = document.createElement("input");
          picker.type = "color";
          picker.value = /^#[0-9a-f]{6}$/i.test(hidden.value) ? hidden.value : UNKNOWN_COLOR;
          picker.setAttribute("aria-label", `${field.label} picker`);
          const swatches = document.createElement("div");
          swatches.className = "walf-color-swatches";
          const paint = (hex) => {
            hidden.value = hex;
            if (/^#[0-9a-f]{6}$/i.test(hex)) picker.value = hex;
            swatches.querySelectorAll(".is-selected").forEach((node) => node.classList.remove("is-selected"));
            [...swatches.children].find((node) => node.dataset.color?.toLowerCase() === hex.toLowerCase())
              ?.classList.add("is-selected");
          };
          FOLDER_COLORS.forEach((hex) => {
            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.className = "walf-color-swatch";
            swatch.dataset.color = hex;
            swatch.style.setProperty("--folder-color", hex);
            swatch.setAttribute("aria-label", `Use ${hex}`);
            swatch.addEventListener("click", () => paint(hex));
            swatches.append(swatch);
          });
          picker.addEventListener("input", () => paint(picker.value));
          wrap.append(hidden, swatches, picker);
          label.append(wrap);
          paint(hidden.value);
        } else {
          const control = document.createElement(field.type === "textarea" ? "textarea" : "input");
          control.name = field.name;
          if (control instanceof HTMLInputElement) control.type = field.type || "text";
          control.value = field.value || "";
          control.placeholder = field.placeholder || "";
          if (field.maxLength) control.maxLength = field.maxLength;
          if (field.autocomplete) control.autocomplete = field.autocomplete;
          label.append(control);
        }
        fieldsRoot.append(label);
      });
      const finish = (value) => {
        dialog.remove();
        resolve(value);
      };
      dialog.querySelectorAll("[data-dialog-cancel]").forEach((button) => {
        button.addEventListener("click", () => { dialog.close(); finish(null); }, { once: true });
      });
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); dialog.close(); finish(null); }, { once: true });
      dialog.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        const error = validate?.(values);
        const errorNode = dialog.querySelector(".walf-dialog-error");
        if (error) {
          errorNode.textContent = error;
          errorNode.hidden = false;
          return;
        }
        dialog.close();
        finish(values);
      });
      root.append(dialog);
      dialog.showModal();
      requestAnimationFrame(() => {
        const preferred = fields.find((field) => field.focus);
        const target = preferred?.type === "color"
          ? dialog.querySelector('input[type="color"]')
          : preferred?.name
            ? dialog.querySelector(`[name="${CSS.escape(preferred.name)}"]`)
            : dialog.querySelector("input, textarea");
        target?.focus();
      });
    });
  }

  async function confirmInPage(title, description, confirmLabel = "Continue") {
    const result = await openFormDialog({ title, description, confirmLabel, danger: true });
    return result !== null;
  }

  function copyPhoneButton(phone, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `walf-copy-phone ${className}`.trim();
    button.setAttribute("aria-label", `Copy ${phone}`);
    button.title = "Copy phone number";
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.5" y="3.5" width="10" height="12" rx="2"/><path d="M13.5 16.5v.5H5a2 2 0 0 1-2-2V6.5h.5"/></svg>`;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(phone);
        button.classList.add("is-copied");
        toast(`${phone} copied`);
        setTimeout(() => button.classList.remove("is-copied"), 1200);
      } catch {
        toast("Could not copy phone number");
      }
    });
    return button;
  }

  function syncContactInfoCopy() {
    const drawer = document.querySelector("[data-testid='drawer-right']");
    const preferred = drawer?.querySelector("[data-testid^='contact-info-subtitle']");
    const target = WALeadFoldersClassifier.normalizedPhone(preferred?.textContent)
      ? preferred
      : [...(drawer?.querySelectorAll("span") || [])].find((element) => {
          const box = element.getBoundingClientRect();
          return box.top < (drawer.getBoundingClientRect().top + 380)
            && WALeadFoldersClassifier.normalizedPhone(element.textContent);
        });
    const phone = WALeadFoldersClassifier.normalizedPhone(target?.textContent);
    document.querySelectorAll(".walf-contact-copy").forEach((button) => {
      if (!target?.parentElement?.contains(button)) button.remove();
    });
    if (phone && !target.parentElement.querySelector(":scope > .walf-contact-copy")) {
      target.parentElement.append(copyPhoneButton(phone, "walf-contact-copy"));
    }
  }

  async function createFolder() {
    await editFolder();
  }

  async function renameFolder(folder) {
    await editFolder(folder, "name");
  }

  async function editQuickReply(folder) {
    await editFolder(folder, "reply1");
  }

  async function editFolder(folder = null, focus = "name") {
    const replies = folder ? state.replySequences[folder.id] || [] : [];
    const result = await openFormDialog({
      title: folder ? `Edit ${folder.name}` : "New lead folder",
      description: "Matching phrases suggest this folder. Replies are inserted into the composer and never sent automatically.",
      confirmLabel: folder ? "Save changes" : "Create folder",
      fields: [
        { name: "name", label: "Folder name", value: folder?.name || "", maxLength: 40, focus: focus === "name", autocomplete: "off" },
        { name: "color", label: "Color", hint: "Shown on the chat list, assign chips, and folder headers", type: "color", value: folder?.color || FOLDER_COLORS[0], focus: focus === "color" },
        { name: "rules", label: "Auto-match phrases", hint: "One phrase per line", type: "textarea", value: folder ? (state.folderRules[folder.id] || []).join("\n") : "" },
        ...[0, 1, 2].map((index) => ({ name: `reply${index + 1}`, label: `Reply ${index + 1}`, hint: index ? "Optional next step" : "Primary quick reply", type: "textarea", value: replies[index] || "", maxLength: 1000, focus: focus === `reply${index + 1}` }))
      ],
      validate: ({ name }) => WALeadFoldersClassifier.validatedFolderName(name, state.folders, folder?.id)
        ? null : "Enter a unique folder name."
    });
    if (!result) return;
    const cleanName = WALeadFoldersClassifier.validatedFolderName(result.name, state.folders, folder?.id);
    const target = folder || {
      id: `custom-${Date.now()}`,
      color: FOLDER_COLORS[(state.folders.length - DEFAULT_FOLDERS.length + FOLDER_COLORS.length) % FOLDER_COLORS.length],
      hidden: false
    };
    target.name = cleanName;
    if (/^#[0-9a-f]{3,8}$/i.test(result.color || "")) target.color = result.color;
    if (!folder) state.folders.push(target);
    state.folderRules[target.id] = result.rules.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20);
    state.replySequences[target.id] = [result.reply1, result.reply2, result.reply3]
      .map((reply) => reply.trim().slice(0, 1000)).filter(Boolean);
    if (state.replySequences[target.id][0]) state.quickReplies[target.id] = state.replySequences[target.id][0];
    else delete state.quickReplies[target.id];
    await saveState();
    renderPanel();
    toast(folder ? `${cleanName} updated` : `${cleanName} created`);
  }

  async function toggleFolderHidden(folder) {
    folder.hidden = !folder.hidden;
    await saveState();
    renderPanel();
    toast(folder.hidden
      ? `${folder.name} hidden from the list — you can still assign chats to it`
      : `${folder.name} is shown in the list again`);
  }

  async function moveFolder(folder, delta) {
    const index = state.folders.findIndex((item) => item.id === folder.id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= state.folders.length) return;
    const ordered = state.folders.slice();
    const [item] = ordered.splice(index, 1);
    ordered.splice(next, 0, item);
    state.folders = ordered;
    await saveState();
    renderPanel();
  }

  async function deleteFolder(folder) {
    const assigned = Object.values(state.contacts).filter((contact) => contact.folderId === folder.id);
    if (!await confirmInPage(
      `Delete ${folder.name}?`,
      assigned.length
        ? `${assigned.length} lead${assigned.length === 1 ? "" : "s"} will be unassigned. Matching rules and quick replies for this folder will be removed.`
        : "Matching rules and quick replies for this folder will be removed.",
      "Delete folder"
    )) return;

    state.folders = state.folders.filter((item) => item.id !== folder.id);
    assigned.forEach((contact) => { delete state.contacts[contact.id]; });
    delete state.folderRules[folder.id];
    delete state.replySequences[folder.id];
    delete state.quickReplies[folder.id];
    if (activeInlineTabId === folder.id) activeInlineTabId = null;
    Object.keys(state.leadSuggestions).forEach((id) => {
      if (state.leadSuggestions[id]?.folderId === folder.id) delete state.leadSuggestions[id];
    });
    await saveState();
    renderPanel();
    toast(`${folder.name} deleted`);
  }

  async function undoLastBulk() {
    const undo = state.lastBulkUndo;
    if (!undo?.length) return;
    let restored = 0;
    undo.forEach(({ id, previous, appliedAt }) => {
      if (state.contacts[id]?.updatedAt !== appliedAt) return;
      if (previous) state.contacts[id] = previous;
      else delete state.contacts[id];
      restored += 1;
    });
    state.lastBulkUndo = null;
    await saveState();
    renderPanel();
    toast(`${restored} chat${restored === 1 ? "" : "s"} restored`);
  }

  async function reconcileContacts() {
    const groups = WALeadFoldersClassifier.duplicateContactGroups(state.contacts);
    if (!groups.length) return toast("No duplicate lead identities found");
    const preview = groups.slice(0, 4).map(({ contacts }) => contacts.map((contact) => contact.name).join(" / ")).join("; ");
    if (!await confirmInPage(
      `Merge ${groups.length} duplicate ${groups.length === 1 ? "identity" : "identities"}?`,
      `${preview}${groups.length > 4 ? ` and ${groups.length - 4} more` : ""}. Folder choices made manually take priority.`,
      "Merge duplicates"
    )) return;
    groups.forEach(({ identity, contacts }) => {
      const ranked = [...contacts].sort((a, b) => Number(b.source === "manual") - Number(a.source === "manual")
        || Number(b.id?.startsWith("phone:")) - Number(a.id?.startsWith("phone:"))
        || Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      const winner = ranked[0];
      const mergedFields = Object.assign({}, ...ranked.slice().reverse().map((contact) => contact.fields || {}));
      contacts.forEach((contact) => { delete state.contacts[contact.id]; });
      state.contacts[identity] = {
        ...Object.assign({}, ...ranked.slice().reverse()),
        ...winner,
        id: identity,
        fields: mergedFields,
        aliases: [...new Set(contacts.flatMap((contact) => [contact.name, ...(contact.aliases || [])]).filter(Boolean))],
        firstSeenAt: Math.min(...contacts.map((contact) => Number(contact.firstSeenAt || contact.updatedAt || Date.now()))),
        updatedAt: Math.max(...contacts.map((contact) => Number(contact.updatedAt || 0)))
      };
    });
    await saveState();
    renderPanel();
    toast(`${groups.length} duplicate ${groups.length === 1 ? "identity" : "identities"} merged`);
  }

  function downloadFile(name, type, contents) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
  }

  function exportBackup() {
    downloadFile(
      `wa-lead-folders-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
      JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), state }, null, 2)
    );
  }

  function exportCsv() {
    const folderNames = Object.fromEntries(state.folders.map((folder) => [folder.id, folder.name]));
    const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = Object.values(state.contacts).map((contact) => [
      contact.id, contact.name, folderNames[contact.folderId] || contact.folderId,
      contact.phone || "", contact.fields?.company || "", contact.fields?.activity || "",
      contact.fields?.volume || "", contact.fields?.campaign || "", assignmentSource(contact.source),
      contact.remindAt || "", Number.isFinite(contact.updatedAt) ? new Date(contact.updatedAt).toISOString() : ""
    ]);
    downloadFile(
      `wa-leads-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv;charset=utf-8",
      [["ID", "Name", "Folder", "Phone", "Company", "Activity", "Volume", "Campaign", "Assigned by", "Follow up", "Updated"], ...rows]
        .map((row) => row.map(quote).join(",")).join("\r\n")
    );
  }

  async function restoreBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const imported = parsed.state || parsed;
      if (!WALeadFoldersClassifier.isValidBackupState(imported)) throw new Error("Invalid backup");
      if (!await confirmInPage(
        "Restore lead desk?",
        "This replaces the current folders, rules, replies, follow-ups, and lead records with the selected backup.",
        "Restore backup"
      )) return;
      state = normalizeState(imported);
      scheduleUnscheduledContacts();
      await saveState();
      renderPanel();
      toast("Backup restored");
    } catch {
      toast("That backup file is not valid");
    }
  }

  function upsertContact(chat, changes, source = "manual") {
    const fields = structuredFields(chat.leadText || (chat.id === activeChat()?.id ? visibleConversationText() : ""));
    const chatPhone = WALeadFoldersClassifier.normalizedPhone(chat.phone)
      || WALeadFoldersClassifier.normalizedPhone(chat.name)
      || (chat.id?.startsWith("phone:") ? WALeadFoldersClassifier.normalizedPhone(chat.id.slice(6)) : null);
    const previous = WALeadFoldersClassifier.matchingContact(state.contacts, chat, chatPhone || fields.phone);
    // The WhatsApp chat number is the grouping key. Form phones are often the same
    // number with a leftover local 0 (+2130...). Prefer the chat identity.
    const phone = chatPhone || fields.phone || contactPhone(previous);
    const id = phone ? `phone:${phone.replace(/\D/g, "")}` : chat.id;
    if (previous?.id && previous.id !== id) delete state.contacts[previous.id];
    const updatedAt = Date.now();
    const remindAt = Object.hasOwn(changes, "remindAt") ? changes.remindAt : automaticReminder(previous);
    state.contacts[id] = {
      ...previous,
      id,
      name: fields.fullName || chat.name,
      phone: phone || previous?.phone || null,
      username: chat.username || previous?.username || null,
      jid: chat.jid || previous?.jid || null,
      aliases: [...new Set([...(previous?.aliases || []), chat.name, chat.username && `@${chat.username}`,
        fields.fullName].filter(Boolean))],
      fields: { ...(previous?.fields || {}), ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value)) },
      source,
      sourceReason: changes.sourceReason ?? (source === previous?.source ? previous?.sourceReason : null),
      firstSeenAt: previous?.firstSeenAt || Date.now(),
      remindAt,
      reminderSetAt: remindAt !== previous?.remindAt
        ? (remindAt ? updatedAt : null) : previous?.reminderSetAt || previous?.updatedAt || updatedAt,
      ...changes,
      updatedAt
    };
    forgetLeadSuggestion(chat);
    forgetLeadSuggestion({ id, name: chat.name });
    return state.contacts[id];
  }

  function collapseRowGroupPicker(actions) {
    if (!actions) return;
    actions.classList.remove("is-open");
    actions.querySelector(".walf-row-group-expand")?.setAttribute("aria-expanded", "false");
    const choices = actions.querySelector(".walf-row-group-choices");
    if (choices) choices.inert = true;
    actions.querySelectorAll(".walf-row-group-hidden-menu").forEach((menu) => {
      menu.hidden = true;
    });
    actions.querySelectorAll(".walf-row-group-more").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }

  function appendRowFolderChoice(choices, folder, chat, actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `walf-row-group-choice${folder.hidden ? " is-hidden-folder" : ""}`;
    button.textContent = folder.name.slice(0, 1).toUpperCase();
    button.title = folder.hidden
      ? `Add to ${folder.name} (hidden from chat list)`
      : `Add to ${folder.name}`;
    button.style.setProperty("--folder-color", folder.color);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      collapseRowGroupPicker(actions);
      assignRow(chat, folder);
    });
    choices.append(button);
  }

  function assignRow(chat, folder) {
    collapseRowGroupPicker(chat.row?.querySelector(".walf-row-groups"));
    upsertContact(chat, { folderId: folder.id }, "manual");
    void saveState();
    toast(folder.hidden
      ? `${chat.name} added to ${folder.name} · hidden from list`
      : `${chat.name} added to ${folder.name}`);
    if (triageMode) setTimeout(openNextTriageChat, 120);
  }

  async function saveNativeLead(chat, changes) {
    upsertContact({ ...chat, leadText: visibleConversationText() }, changes, "manual");
    await saveState();
    toast(`${chat.name} updated`);
  }

  function openNextTriageChat() {
    const rows = [...document.querySelectorAll(
      "#pane-side [data-testid='chat-list'] [role='row'][data-testid^='list-item-']:not(.walf-inline-hidden)"
    )].filter((row) => row.querySelector("[data-testid='cell-frame-title'] span[title]"));
    if (!rows.length) return toast("No lead is available in this queue");
    const current = rows.findIndex((row) => row.getAttribute("aria-selected") === "true"
      || row.querySelector("[aria-selected='true']"));
    rows[(current + 1 + rows.length) % rows.length].click();
  }

  function queueMatches(contact) {
    if (queueMode === "all") return true;
    if (queueMode === "unassigned") return !contact;
    const bucket = WALeadFoldersClassifier.followUpBucket(contact?.remindAt);
    if (queueMode === "due") return bucket === "today" || bucket === "overdue";
    return bucket === queueMode;
  }

  function syncNativeLeadTools() {
    const header = document.querySelector("#main header");
    const info = header?.querySelector("[data-testid='conversation-info-header']");
    const chat = activeChat();
    if (!header || !info || !chat) {
      document.querySelector(".walf-native-lead-tools")?.remove();
      return;
    }

    repairStatusContact(chat);
    const contact = savedContact(chat);
    const text = visibleConversationText();
    const parsedFields = structuredFields(text);
    const drawerPhone = WALeadFoldersClassifier.normalizedPhone(
      document.querySelector("[data-testid='drawer-right'] [data-testid^='contact-info-subtitle']")?.textContent
    );
    const phone = drawerPhone || WALeadFoldersClassifier.normalizedPhone(chat.name)
      || contactPhone(contact) || parsedFields.phone || chat.phone;
    const fields = { ...parsedFields, ...(contact?.fields || {}) };
    const { suggestion, score } = resolveLeadInsight(chat, text, contact);
    let tools = header.querySelector(".walf-native-lead-tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "walf-native-lead-tools";
      info.after(tools);
    }

    const assignedFolder = state.folders.find((folder) => folder.id === contact?.folderId);
    const suggestedFolder = foldersForAssignment().find((folder) => folder.id === suggestion?.folderId);
    const signature = [chat.id, assignedFolder?.id, contact?.remindAt, contact?.source, score?.level, score?.points,
      suggestedFolder?.id, queueMode, triageMode, fields.company, fields.activity, fields.volume,
      folderSignature()].join("|");
    if (tools.dataset.signature === signature) return;
    tools.dataset.signature = signature;
    const assignable = foldersForAssignment();
    const folderOptions = [
      ...assignable.filter((folder) => !folder.hidden),
      ...assignable.filter((folder) => folder.hidden)
    ];
    const scoreBadge = score
      ? `<span class="walf-native-score" data-level="${score.level}" title="Lead score: ${score.points} points">${score.label} ${score.points}</span>`
      : "";
    const pendingSuggestion = Boolean(suggestedFolder && !assignedFolder);
    tools.innerHTML = `
      <div class="walf-native-menu">
        ${pendingSuggestion ? `
          <button type="button" class="walf-native-auto-assign" style="--folder-color:${escapeHtml(suggestedFolder.color)}" title="Suggested: ${escapeHtml(suggestedFolder.name)}${suggestedFolder.hidden ? " · hidden from list" : ""}. Click to assign">
            ${scoreBadge}
            <i>${escapeHtml(suggestedFolder.name.slice(0, 1).toUpperCase())}</i>
            <b>Assign ${escapeHtml(suggestedFolder.name)}</b>
          </button>
          <button type="button" class="walf-native-menu-trigger is-compact" popovertarget="walf-native-popover" aria-label="Open lead tools" aria-expanded="false">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
          </button>
        ` : `
          <button type="button" class="walf-native-menu-trigger" popovertarget="walf-native-popover" aria-label="Open lead tools" aria-expanded="false">
            ${scoreBadge}
            <b>${escapeHtml(assignedFolder?.name || "Lead tools")}${assignedFolder?.hidden ? " · hidden" : ""}</b>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
          </button>
        `}
        <div id="walf-native-popover" class="walf-native-popover" popover>
          <label><span>Folder</span><select class="walf-native-folder${pendingSuggestion ? " is-suggested" : ""}" aria-label="Lead folder">
            <option value="">${assignedFolder ? "Remove folder" : suggestedFolder ? `Suggested: ${escapeHtml(suggestedFolder.name)}` : "Assign folder"}</option>
            ${folderOptions.map((folder) => `<option value="${escapeHtml(folder.id)}" ${folder.id === assignedFolder?.id ? "selected" : ""}>${escapeHtml(folder.name)}${folder.hidden ? " · hidden" : ""}</option>`).join("")}
          </select></label>
          <label><span>Follow up</span><input class="walf-native-reminder" type="datetime-local" value="${escapeHtml(contact?.remindAt || "")}" aria-label="Follow-up reminder" ${contact ? "" : "disabled"}></label>
          <label><span>Queue</span><select class="walf-native-queue" aria-label="Lead queue">
            <option value="all" ${queueMode === "all" ? "selected" : ""}>All leads</option>
            <option value="due" ${queueMode === "due" ? "selected" : ""}>Due</option>
            <option value="overdue" ${queueMode === "overdue" ? "selected" : ""}>Overdue</option>
            <option value="waiting" ${queueMode === "waiting" ? "selected" : ""}>Waiting</option>
            <option value="unassigned" ${queueMode === "unassigned" ? "selected" : ""}>Unassigned</option>
          </select></label>
          <div class="walf-native-actions">
            <button type="button" class="walf-native-triage" aria-pressed="${triageMode}" title="Keyboard triage: 1-9 assign, F follow-up, Q reply, N next">${triageMode ? "Triage on" : "Triage"}</button>
            <button type="button" class="walf-native-next" title="Next lead (N)">Next lead →</button>
          </div>
          ${contact?.source || [fields.company, fields.activity, fields.volume].some(Boolean) ? `<div class="walf-lead-summary">
            ${contact?.source ? `<i title="${escapeHtml(contact.sourceReason || "Assignment source")}">${assignmentSource(contact.source)}</i>` : ""}
            ${fields.company ? `<i title="Company">${escapeHtml(fields.company)}</i>` : ""}
            ${fields.activity ? `<i title="Activity">${escapeHtml(fields.activity)}</i>` : ""}
            ${fields.volume ? `<i title="Volume">${escapeHtml(fields.volume)}</i>` : ""}
          </div>` : ""}
        </div>
      </div>
    `;
    if (phone) tools.prepend(copyPhoneButton(phone));
    const menuTriggers = [...tools.querySelectorAll(".walf-native-menu-trigger")];
    const popover = tools.querySelector(".walf-native-popover");
    popover.addEventListener("toggle", (event) => {
      const open = event.newState === "open";
      menuTriggers.forEach((trigger) => trigger.setAttribute("aria-expanded", String(open)));
      if (!open) return;
      const anchor = (menuTriggers[0] || tools).getBoundingClientRect();
      popover.style.left = `${Math.max(8, Math.min(anchor.right - popover.offsetWidth, innerWidth - popover.offsetWidth - 8))}px`;
      popover.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, innerHeight - popover.offsetHeight - 8))}px`;
    });
    tools.querySelector(".walf-native-auto-assign")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!suggestedFolder) return;
      await saveNativeLead(chat, {
        folderId: suggestedFolder.id,
        sourceReason: suggestion?.reason || "Accepted folder suggestion"
      });
    });
    tools.querySelector(".walf-native-folder").addEventListener("change", async (event) => {
      const folderId = event.currentTarget.value;
      if (!folderId) {
        const existing = savedContact(chat);
        if (existing?.nativeSynced) {
          await NativeLists.setActiveChatLists({ remove: [existing.nativeSynced], knownNames: knownNativeLists() });
        }
        if (existing?.id) delete state.contacts[existing.id];
        await saveState();
        toast(`${chat.name} removed from folders`);
        return;
      }
      await saveNativeLead(chat, { folderId });
    });
    tools.querySelector(".walf-native-reminder").addEventListener("change", async (event) => {
      const current = savedContact(chat);
      if (current) await saveNativeLead(chat, { folderId: current.folderId, remindAt: event.currentTarget.value || null });
    });
    tools.querySelector(".walf-native-queue").addEventListener("change", (event) => {
      queueMode = event.currentTarget.value;
      syncInlineFolders();
      syncNativeLeadTools();
    });
    tools.querySelector(".walf-native-triage").addEventListener("click", () => {
      triageMode = !triageMode;
      syncNativeLeadTools();
      toast(triageMode ? "Triage keys enabled: 1-9, F, Q, N" : "Triage keys disabled");
    });
    tools.querySelector(".walf-native-next").addEventListener("click", openNextTriageChat);
  }

  function syncRowActions(chat) {
    const title = chat.row.querySelector("[data-testid='cell-frame-title']");
    if (!title) return;
    let actions = title.querySelector(":scope > .walf-row-groups");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "walf-row-groups";
      title.append(actions);
    }

    const current = state.folders.find((folder) => folder.id === chat.folderId);
    const suggested = foldersForAssignment().find((folder) => folder.id === chat.suggestion?.folderId);
    const signature = `${chat.name}|${current?.id || ""}|${suggested?.id || ""}|${chat.score?.level || ""}|${chat.due}|${folderSignature()}`;
    if (actions.dataset.signature === signature) return;
    actions.dataset.signature = signature;
    actions.classList.remove("is-open");
    actions.replaceChildren();

    if (chat.score) {
      const score = document.createElement("span");
      score.className = "walf-lead-score";
      score.dataset.level = chat.score.level;
      score.textContent = chat.score.label.slice(0, 1);
      score.title = `${chat.score.label} lead (${chat.score.points} points)`;
      actions.append(score);
    }
    if (chat.due) {
      const due = document.createElement("span");
      due.className = "walf-reminder-due";
      due.textContent = "!";
      due.title = "Follow-up due";
      actions.append(due);
    }

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = `walf-row-group-trigger${suggested && !current ? " is-suggested" : ""}`;
    trigger.textContent = (current || suggested)?.name.slice(0, 1).toUpperCase() || "+";
    trigger.title = current
      ? `Assigned to ${current.name}${current.hidden ? " · hidden from list" : ""}`
      : suggested
        ? `Suggested: ${suggested.name}${suggested.hidden ? " · hidden from list" : ""}. Click to assign`
        : "Assign to a folder";
    trigger.style.setProperty("--folder-color", (current || suggested)?.color || DEFAULT_UNASSIGNED_COLOR);
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (suggested && !current) assignRow(chat, suggested);
      else {
        const open = actions.classList.toggle("is-open");
        if (!open) collapseRowGroupPicker(actions);
        else {
          actions.querySelector(".walf-row-group-expand")?.setAttribute("aria-expanded", "true");
          actions.querySelector(".walf-row-group-choices").inert = false;
        }
      }
    });
    actions.append(trigger);

    let expand;
    if (current || suggested || hiddenFolders().length) {
      expand = document.createElement("button");
      expand.type = "button";
      expand.className = "walf-row-group-expand";
      expand.setAttribute("aria-label", `Show other folders for ${chat.name}`);
      expand.setAttribute("aria-expanded", "false");
      expand.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>`;
      expand.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = actions.classList.toggle("is-open");
        if (!open) collapseRowGroupPicker(actions);
        else {
          expand.setAttribute("aria-expanded", "true");
          actions.querySelector(".walf-row-group-choices").inert = false;
        }
      });
    }

    const choices = document.createElement("div");
    choices.className = "walf-row-group-choices";
    choices.inert = true;
    const otherFolders = foldersForAssignment().filter((folder) => folder.id !== current?.id);
    const visibleChoices = otherFolders.filter((folder) => !folder.hidden);
    const hiddenChoices = otherFolders.filter((folder) => folder.hidden);
    visibleChoices.forEach((folder) => appendRowFolderChoice(choices, folder, chat, actions));
    if (hiddenChoices.length && hiddenChoices.length <= ROW_HIDDEN_CHIP_LIMIT) {
      hiddenChoices.forEach((folder) => appendRowFolderChoice(choices, folder, chat, actions));
    } else if (hiddenChoices.length > ROW_HIDDEN_CHIP_LIMIT) {
      const moreWrap = document.createElement("div");
      moreWrap.className = "walf-row-group-more-wrap";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "walf-row-group-choice walf-row-group-more";
      more.textContent = "⋯";
      more.title = `${hiddenChoices.length} hidden folders`;
      more.setAttribute("aria-label", `Show ${hiddenChoices.length} hidden folders`);
      more.setAttribute("aria-expanded", "false");
      const menu = document.createElement("div");
      menu.className = "walf-row-group-hidden-menu";
      menu.hidden = true;
      hiddenChoices.forEach((folder) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "walf-row-group-hidden-item";
        item.innerHTML = `<i style="--folder-color:${escapeHtml(folder.color)}"></i><span>${escapeHtml(folder.name)}</span>`;
        item.title = `Add to ${folder.name} (hidden from chat list)`;
        item.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          collapseRowGroupPicker(actions);
          assignRow(chat, folder);
        });
        menu.append(item);
      });
      more.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = menu.hidden;
        actions.querySelectorAll(".walf-row-group-hidden-menu").forEach((node) => {
          node.hidden = true;
        });
        actions.querySelectorAll(".walf-row-group-more").forEach((button) => {
          button.setAttribute("aria-expanded", "false");
        });
        menu.hidden = !open;
        more.setAttribute("aria-expanded", String(open));
      });
      moreWrap.append(more, menu);
      choices.append(moreWrap);
    }
    actions.append(choices);
    if (expand) actions.append(expand);
  }

  function nativeLinksMarkup() {
    const names = knownNativeLists();
    const suggestions = state.folders.filter((folder) => !folder.nativeList
      && WALeadFoldersClassifier.guessNativeList(folder.name, names));
    const options = (folder) => [...new Set([...names, folder.nativeList].filter(Boolean))]
      .map((name) => `<option value="${escapeHtml(name)}" ${name === folder.nativeList ? "selected" : ""}>${escapeHtml(name)}</option>`)
      .join("");
    return `
      <section class="walf-native-links" aria-label="WhatsApp lists">
        <div class="walf-native-links-head">
          <span class="walf-section-label">WHATSAPP LISTS</span>
          ${suggestions.length ? `<button type="button" data-action="link-suggested">Link ${suggestions.length} by name</button>` : ""}
        </div>
        <p>A linked folder opens WhatsApp's own list, so every lead shows up, and assignments sync to your phone.</p>
        ${names.length ? "" : `<p class="walf-native-links-empty">No WhatsApp lists seen yet. They appear as filter chips above your chats.</p>`}
        ${state.folders.map((folder) => `
          <label class="walf-native-link">
            <i style="--folder-color:${escapeHtml(folder.color)}"></i>
            <span>${escapeHtml(folder.name)}</span>
            <select data-folder-id="${escapeHtml(folder.id)}" aria-label="WhatsApp list for ${escapeHtml(folder.name)}">
              <option value="">Not linked</option>${options(folder)}
            </select>
          </label>`).join("")}
        <button type="button" class="walf-native-probe" data-action="probe">Copy structure report</button>
      </section>
    `;
  }

  function renderPanel() {
    const duplicates = WALeadFoldersClassifier.duplicateContactGroups(state.contacts);
    panel.innerHTML = `
      <header class="walf-panel-header">
        <h2>Lead tools</h2>
      </header>
      <p class="walf-settings-note">Daily lead actions now live beside the WhatsApp contact name.</p>
      <label class="walf-auto-followup">
        <span>Automatic follow-up</span>
        <input type="number" data-action="auto-followup" min="0" max="720" step="1" value="${state.autoFollowUpHours}">
        <em>hours after assigning · 0 disables</em>
      </label>
      <div class="walf-folder-toolbar">
        <span>${Object.keys(state.contacts).length} classified</span>
        <div>
          ${state.lastBulkUndo?.length ? `<button type="button" data-action="undo-bulk">Undo ${state.lastBulkUndo.length}</button>` : ""}
          ${duplicates.length ? `<button type="button" data-action="reconcile">Review ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}</button>` : ""}
          <button type="button" data-action="toggle-grouping" aria-pressed="${state.groupingEnabled}">Inline: ${state.groupingEnabled ? "On" : "Off"}</button>
          <button type="button" data-action="new-folder">+ New folder</button>
        </div>
      </div>
      ${nativeLinksMarkup()}
      <div class="walf-folders"></div>
      <footer class="walf-data-tools">
        <button type="button" data-action="backup">Backup JSON</button>
        <button type="button" data-action="csv">Export CSV</button>
        <button type="button" data-action="restore-button">Restore</button>
        <input type="file" data-action="restore" accept="application/json,.json" hidden>
      </footer>
    `;

    panel.querySelectorAll(".walf-native-link select").forEach((select) => {
      select.addEventListener("change", async (event) => {
        const folder = state.folders.find((item) => item.id === event.currentTarget.dataset.folderId);
        if (!folder) return;
        folder.nativeList = event.currentTarget.value || null;
        await saveState();
        renderPanel();
        toast(folder.nativeList ? `${folder.name} linked to WhatsApp list ${folder.nativeList}` : `${folder.name} unlinked`);
      });
    });
    panel.querySelector("[data-action='link-suggested']")?.addEventListener("click", async () => {
      const names = knownNativeLists();
      const linked = state.folders.filter((folder) => !folder.nativeList).map((folder) => {
        folder.nativeList = WALeadFoldersClassifier.guessNativeList(folder.name, names);
        return folder.nativeList ? folder : null;
      }).filter(Boolean);
      await saveState();
      renderPanel();
      toast(`${linked.length} folder${linked.length === 1 ? "" : "s"} linked`);
    });
    panel.querySelector("[data-action='probe']").addEventListener("click", async () => {
      const report = JSON.stringify(await NativeLists.probe({
        openMenu: Boolean(activeChat()),
        knownNames: knownNativeLists()
      }), null, 2);
      try {
        await navigator.clipboard.writeText(report);
        toast("Structure report copied");
      } catch {
        downloadFile(`wa-structure-${new Date().toISOString().slice(0, 10)}.json`, "application/json", report);
        toast("Structure report downloaded");
      }
    });
    panel.querySelector("[data-action='new-folder']").addEventListener("click", createFolder);
    panel.querySelector("[data-action='undo-bulk']")?.addEventListener("click", undoLastBulk);
    panel.querySelector("[data-action='reconcile']")?.addEventListener("click", reconcileContacts);
    panel.querySelector("[data-action='backup']").addEventListener("click", exportBackup);
    panel.querySelector("[data-action='csv']").addEventListener("click", exportCsv);
    panel.querySelector("[data-action='restore-button']").addEventListener("click", () => {
      panel.querySelector("[data-action='restore']").click();
    });
    panel.querySelector("[data-action='restore']").addEventListener("change", (event) => {
      const file = event.currentTarget.files[0];
      event.currentTarget.value = "";
      if (file) void restoreBackup(file);
    });
    panel.querySelector("[data-action='auto-followup']").addEventListener("change", async (event) => {
      state.autoFollowUpHours = Math.min(720, Math.max(0, Number(event.currentTarget.value) || 0));
      event.currentTarget.value = state.autoFollowUpHours;
      await saveState();
      toast(state.autoFollowUpHours ? `Follow-up set to ${state.autoFollowUpHours} hours` : "Automatic follow-up disabled");
    });
    panel.querySelector("[data-action='toggle-grouping']").addEventListener("click", async () => {
      state.groupingEnabled = !state.groupingEnabled;
      await saveState();
      renderPanel();
      toast(`Inline grouping ${state.groupingEnabled ? "enabled" : "disabled"}`);
    });

    const foldersRoot = panel.querySelector(".walf-folders");
    if (!state.folders.length) {
      foldersRoot.innerHTML = `<div class="walf-folder-empty">No folders yet. Create one to start grouping leads.</div>`;
      return;
    }
    state.folders.forEach((folder, index) => {
      const contacts = Object.values(state.contacts)
        .filter((contact) => contact.folderId === folder.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const card = document.createElement("div");
      card.className = `walf-folder${folder.hidden ? " is-hidden" : ""}`;
      card.dataset.folderId = folder.id;
      card.innerHTML = `
        <div class="walf-folder-setting">
          <div class="walf-folder-reorder">
            <button type="button" class="walf-folder-move" data-move="-1" aria-label="Move ${escapeHtml(folder.name)} up" title="Move up" ${index === 0 ? "disabled" : ""}>▲</button>
            <button type="button" class="walf-folder-move" data-move="1" aria-label="Move ${escapeHtml(folder.name)} down" title="Move down" ${index === state.folders.length - 1 ? "disabled" : ""}>▼</button>
          </div>
          <button type="button" class="walf-folder-color" style="--folder-color:${folder.color}" aria-label="Change color for ${escapeHtml(folder.name)}" title="Change folder color"></button>
          <span title="${folder.hidden ? "Hidden from chat list — still available when assigning" : ""}">${escapeHtml(folder.name)}${folder.hidden ? " · hidden" : ""}</span>
          <b>${contacts.length}</b>
          <button class="walf-folder-visibility" type="button" aria-pressed="${folder.hidden}" aria-label="${folder.hidden ? "Show in chat list" : "Hide from chat list"} ${escapeHtml(folder.name)}" title="${folder.hidden ? "Show folder and its chats in the list" : "Hide from chat list (still assignable)"}">${folder.hidden ? "○" : "●"}</button>
          <button class="walf-folder-reply${state.replySequences[folder.id]?.length ? " has-reply" : ""}" type="button" aria-label="Edit replies for ${escapeHtml(folder.name)}" title="${state.replySequences[folder.id]?.length || 0} quick replies">↩${state.replySequences[folder.id]?.length || ""}</button>
          <button class="walf-folder-edit" type="button" aria-label="Edit ${escapeHtml(folder.name)}" title="Name and ${state.folderRules[folder.id]?.length || 0} matching rules">✎</button>
          <button class="walf-folder-delete" type="button" aria-label="Delete ${escapeHtml(folder.name)}" title="Delete folder">×</button>
        </div>
      `;
      card.querySelectorAll(".walf-folder-move").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          void moveFolder(folder, Number(button.dataset.move));
        });
      });
      card.querySelector(".walf-folder-visibility").addEventListener("click", (event) => {
        event.preventDefault();
        void toggleFolderHidden(folder);
      });
      card.querySelector(".walf-folder-color").addEventListener("click", (event) => {
        event.preventDefault();
        void editFolder(folder, "color");
      });
      card.querySelector(".walf-folder-edit").addEventListener("click", (event) => {
        event.preventDefault();
        void renameFolder(folder);
      });
      card.querySelector(".walf-folder-reply").addEventListener("click", (event) => {
        event.preventDefault();
        void editQuickReply(folder);
      });
      card.querySelector(".walf-folder-delete").addEventListener("click", (event) => {
        event.preventDefault();
        void deleteFolder(folder);
      });
      foldersRoot.append(card);
    });
  }

  function knownNativeLists() {
    return [...new Set([...state.nativeListNames, ...NativeLists.listNames()])];
  }

  function rememberNativeListNames(names = []) {
    const known = new Set(state.nativeListNames);
    const fresh = names.filter((name) => name && !known.has(name));
    if (!fresh.length) return;
    state.nativeListNames = [...state.nativeListNames, ...fresh].slice(0, 50);
    void persistState();
    if (panel && !panel.hidden) renderPanel();
  }

  const linkedFolder = (listName) => listName
    ? state.folders.find((folder) => WALeadFoldersClassifier.sameNativeList(folder.nativeList, listName)) || null
    : null;

  async function activateNativeForTab(tabId) {
    const folder = state.folders.find((item) => item.id === tabId);
    if (folder?.nativeList) {
      if (!await NativeLists.activate(folder.nativeList)) {
        toast(`WhatsApp list "${folder.nativeList}" not found. Showing saved leads instead`);
      }
    } else if (NativeLists.activeListName()) {
      // Unlinked tabs filter locally, so WhatsApp must show its full list underneath.
      await NativeLists.activateAll();
    }
    setTimeout(syncInlineFolders, 150);
  }

  // Rows WhatsApp shows under a linked list are members of that folder.
  function importNativeMembers(chats, folder) {
    const search = document.querySelector("#side [contenteditable='true'][role='textbox'], #side input[placeholder]");
    if ((search?.value || search?.textContent || "").trim()) return;
    let changed = false;
    chats.forEach((chat) => {
      const contact = chat.contact;
      if (contact && WALeadFoldersClassifier.sameNativeList(contact.nativeSynced, folder.nativeList)) return;
      const currentFolder = state.folders.find((item) => item.id === contact?.folderId);
      if (currentFolder?.nativeList && currentFolder.id !== folder.id) return;
      if (contact?.folderId === folder.id) {
        contact.nativeSynced = folder.nativeList;
      } else {
        upsertContact(chat, {
          folderId: folder.id,
          nativeSynced: folder.nativeList,
          sourceReason: `In WhatsApp list ${folder.nativeList}`,
          ...(contact ? {} : { remindAt: null })
        }, "whatsapp");
      }
      changed = true;
    });
    if (changed) void persistState();
  }

  function nativeListHeight(grid, rows) {
    const declared = Number.parseFloat(grid.style.height);
    if (declared) return declared;
    return Math.max(0, ...rows.map((row) => -WALeadFoldersClassifier.rowOffset(row.style.transform, 0)
      + (Number.parseFloat(row.style.height) || 72)));
  }

  // Brings the open chat's WhatsApp lists in line with its folder, once per change unless forced.
  async function syncActiveChatNativeList({ force = false } = {}) {
    if (nativeSyncBusy || !state || root?.querySelector("dialog[open]")) return "busy";
    const chat = activeChat();
    const contact = chat ? savedContact(chat) : null;
    if (!contact) return "no-lead";
    const target = state.folders.find((folder) => folder.id === contact.folderId)?.nativeList || null;
    const current = contact.nativeSynced || null;
    if (target === current || WALeadFoldersClassifier.sameNativeList(target, current)) return "synced";
    const attempt = `${contact.id}|${current}|${target}`;
    if (nativeSyncAttempts.has(attempt) && !force) return "failed";
    nativeSyncAttempts.add(attempt);
    nativeSyncBusy = true;
    try {
      const result = await NativeLists.setActiveChatLists({
        add: target ? [target] : [],
        remove: current ? [current] : [],
        knownNames: knownNativeLists()
      });
      rememberNativeListNames(result.names);
      if (!result.ok) {
        if (!batchSync) toast(`WhatsApp list not updated (${result.reason}). Lead tools → Copy structure report`);
        else batchSync.lastError = result.reason;
        return "failed";
      }
      contact.nativeSynced = target;
      await saveState();
      if (!batchSync) toast(target ? `Added to WhatsApp list ${target}` : `Removed from WhatsApp list ${current}`);
      return "synced";
    } finally {
      nativeSyncBusy = false;
    }
  }

  const pendingNativeLeads = (folder) => Object.values(state.contacts).filter((contact) => contact.folderId === folder.id
    && !WALeadFoldersClassifier.sameNativeList(contact.nativeSynced, folder.nativeList));

  async function openAndSyncLead(contactId, folder) {
    const contact = state.contacts[contactId];
    if (!contact || !await openSavedContact(contact, { reload: false })) return false;
    const opened = await waitForValue(() => {
      const chat = activeChat();
      return chat && savedContact(chat)?.id === contactId;
    }, 6000);
    if (!opened) return false;
    for (let tries = 0; tries < 30; tries += 1) {
      if (WALeadFoldersClassifier.sameNativeList(state.contacts[contactId]?.nativeSynced, folder.nativeList)) return true;
      if ((await syncActiveChatNativeList({ force: true })) === "failed") return false;
      await sleep(250);
    }
    return false;
  }

  // Opens every lead in the folder that isn't in its WhatsApp list yet, one at a time.
  async function syncFolderToNativeList(folder) {
    if (batchSync || !folder?.nativeList) return;
    const queue = pendingNativeLeads(folder).map((contact) => contact.id);
    if (!queue.length) return toast(`Every ${folder.name} lead is already in ${folder.nativeList}`);
    batchSync = { folder, total: queue.length, done: 0, added: 0, failed: [], stopped: false, lastError: null };
    renderBatchBar();
    try {
      for (const id of queue) {
        if (batchSync.stopped) break;
        const name = state.contacts[id]?.name || id;
        if (await openAndSyncLead(id, folder)) batchSync.added += 1;
        else batchSync.failed.push(name);
        batchSync.done += 1;
        renderBatchBar();
        // Leave WhatsApp a breath between chats instead of hammering it.
        await sleep(700);
      }
    } finally {
      const { added, failed, stopped, lastError } = batchSync;
      batchSync = null;
      renderBatchBar();
      clearChatSearch();
      activeInlineTabId = folder.id;
      await activateNativeForTab(folder.id);
      toast(`${stopped ? "Stopped. " : ""}${added} added to ${folder.nativeList}${failed.length
        ? ` · ${failed.length} couldn't be opened${lastError ? ` (${lastError})` : ""}` : ""}`);
      if (failed.length) console.info("WA Lead Folders: leads not synced", failed);
    }
  }

  function renderBatchBar() {
    let bar = root.querySelector(".walf-batch");
    if (!batchSync) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "walf-batch";
      bar.setAttribute("role", "status");
      bar.innerHTML = `<div><b></b><span></span></div><progress max="1" value="0"></progress><button type="button">Stop</button>`;
      bar.querySelector("button").addEventListener("click", () => {
        if (batchSync) batchSync.stopped = true;
      });
      root.append(bar);
    }
    bar.querySelector("b").textContent = `Adding to ${batchSync.folder.nativeList}`;
    bar.querySelector("span").textContent = `${batchSync.done} of ${batchSync.total}${batchSync.failed.length
      ? ` · ${batchSync.failed.length} skipped` : ""}`;
    bar.querySelector("progress").max = batchSync.total;
    bar.querySelector("progress").value = batchSync.done;
  }

  function syncTabOverflow(tabs) {
    const max = tabs.scrollWidth - tabs.clientWidth;
    tabs.classList.toggle("has-more-start", tabs.scrollLeft > 2);
    tabs.classList.toggle("has-more-end", tabs.scrollLeft < max - 2);
  }

  function syncStickyTabs(grid, tabs) {
    const pane = document.querySelector("#pane-side");
    if (!pane || !tabs?.isConnected) return;
    if (!pane.dataset.walfTabStickyBound) {
      pane.dataset.walfTabStickyBound = "true";
      pane.addEventListener("scroll", () => {
        const currentGrid = document.querySelector("#pane-side [data-testid='chat-list'] [role='grid']");
        const currentTabs = currentGrid?.querySelector(":scope > .walf-inline-tabs");
        if (currentGrid && currentTabs) syncStickyTabs(currentGrid, currentTabs);
      }, { passive: true });
    }
    const base = Number(tabs.dataset.baseY || 0);
    const gridHeight = Number.parseFloat(grid.style.minHeight) || grid.getBoundingClientRect().height;
    const stickyTop = Math.max(0, pane.scrollTop - grid.offsetTop);
    const max = Math.max(base, gridHeight - INLINE_TAB_HEIGHT);
    const y = Math.min(Math.max(base, stickyTop), max);
    tabs.style.transform = `translateY(${y}px)`;
    tabs.style.zIndex = String(grid.children.length + 10);
    tabs.classList.toggle("is-stuck", y > base);
  }

  function syncInlineFolders() {
    if (!state) return;
    completeFollowUpFromOutgoing();
    // ponytail: Group loaded virtual rows only; expand this if WhatsApp exposes a supported chat-list API.
    const grid = document.querySelector("#pane-side [data-testid='chat-list'] [role='grid']");
    if (!grid) return;

    const rows = [...grid.querySelectorAll(":scope > [role='row'][data-testid^='list-item-']")];
    rows.forEach((row) => {
      row.classList.remove("walf-inline-hidden");
      row.style.removeProperty("translate");
    });
    grid.querySelectorAll(":scope > .walf-inline-missing")
      .forEach((row) => row.classList.remove("walf-inline-hidden"));
    if (!state.groupingEnabled) {
      activeInlineTabId = null;
      grid.querySelectorAll(":scope > .walf-inline-tabs, :scope > .walf-inline-empty, :scope > .walf-inline-folder, :scope > .walf-inline-bulk, :scope > .walf-inline-missing, :scope > .walf-inline-section")
        .forEach((element) => element.remove());
      rows.forEach((row) => row.querySelector(".walf-row-groups")?.remove());
      grid.style.removeProperty("min-height");
      return;
    }

    grid.querySelectorAll(":scope > .walf-inline-folder").forEach((element) => element.remove());
    const prefix = [];
    const chats = [];
    const active = activeChat();
    rows.forEach((row) => {
      const name = row.querySelector("[data-testid='cell-frame-title'] span[title]")
        ?.getAttribute("title")?.trim();
      if (!name) {
        prefix.push(row);
        return;
      }
      const rowText = nativeChatRowText(row);
      const chat = describeVisibleChat(name, row, { text: rowText });
      const contact = savedContact(chat);
      const { id } = chat;
      const leadText = active && (active.id === id || active.name === name || (active.rowKey && active.rowKey === chat.rowKey))
        ? [visibleConversationText(), rowText].filter(Boolean).join("\n")
        : rowText;
      const { suggestion, score } = resolveLeadInsight(chat, leadText, contact);
      const unreadBadge = row.querySelector("[data-testid='icon-unread-count']");
      const unread = WALeadFoldersClassifier.hasUnread(
        unreadBadge?.textContent?.trim(),
        unreadBadge?.getAttribute("aria-label")
      );
      chats.push({
        ...chat, row, leadText, contact, folderId: contact?.folderId || null, suggestion, unread,
        due: isDue(contact), score,
        isLeadForm: WALeadFoldersClassifier.isLeadForm(leadText)
      });
    });

    chats.forEach(syncRowActions);
    const hiddenFolderIds = new Set(state.folders.filter((folder) => folder.hidden).map((folder) => folder.id));
    const visibleChats = chats.filter((chat) => queueMatches(chat.contact));
    chats.filter((chat) => !queueMatches(chat.contact))
      .forEach((chat) => chat.row.classList.add("walf-inline-hidden"));

    // Hidden folders keep their assignments; the whole group (tab + chats + off-list leads) is omitted from the list.
    const hiddenChats = visibleChats.filter((chat) => chat.folderId && hiddenFolderIds.has(chat.folderId));
    hiddenChats.forEach((chat) => chat.row.classList.add("walf-inline-hidden"));
    const listableChats = visibleChats.filter((chat) => !(chat.folderId && hiddenFolderIds.has(chat.folderId)));

    const plan = WALeadFoldersClassifier.planInlineFolders(listableChats, visibleFolders());
    const reviewRows = plan.ungrouped.filter((chat) => chat.isLeadForm && !chat.suggestion);
    const ungroupedRows = plan.ungrouped.filter((chat) => !chat.isLeadForm || chat.suggestion);
    const groupedRows = new Map(plan.groups.map(({ folder, rows: folderRows }) => [folder.id, folderRows]));
    const tabGroups = visibleFolders().map((folder) => ({
      folder,
      folderRows: groupedRows.get(folder.id) || [],
      kind: "folder"
    })).filter(({ folder, folderRows }) => folderRows.length || folder.nativeList
      || Object.values(state.contacts).some((contact) => contact.folderId === folder.id));
    if (reviewRows.length) {
      tabGroups.push({
        folder: { id: "__review__", name: "Review queue", color: "#87938f" },
        folderRows: reviewRows,
        kind: "review"
      });
    }
    if (ungroupedRows.length || Object.values(state.contacts).some((contact) => !contact.folderId)) {
      tabGroups.push({
        folder: { id: INLINE_UNASSIGNED_ID, name: "Unassigned", color: DEFAULT_UNASSIGNED_COLOR },
        folderRows: ungroupedRows,
        kind: "unassigned"
      });
    }
    const tabDetails = tabGroups.map(({ folder, folderRows, kind }) => {
      const missing = kind === "folder" || kind === "unassigned" ? Object.values(state.contacts)
        .filter((contact) => (kind === "folder" ? contact.folderId === folder.id : !contact.folderId)
          && queueMatches(contact)
          && !folderRows.some((chat) => chat.contact?.id === contact.id)) : [];
      const classified = kind === "folder"
        ? Object.values(state.contacts).filter((contact) => contact.folderId === folder.id).length
        : kind === "review" ? folderRows.length
          : folderRows.length + missing.length;
      return {
        folder, folderRows, kind, missing, classified,
        unread: folderRows.filter((chat) => chat.unread).length,
        due: folderRows.filter((chat) => chat.due).length
      };
    });
    const tabIds = new Set(tabDetails.map(({ folder }) => folder.id));
    // Follow WhatsApp's own list chips: picking a linked list there selects its tab here.
    const nativeActive = NativeLists.activeListName();
    if (nativeActive !== lastNativeActive) {
      lastNativeActive = nativeActive;
      const followed = linkedFolder(nativeActive);
      if (followed && tabIds.has(followed.id)) activeInlineTabId = followed.id;
    }
    if (!tabIds.has(activeInlineTabId)) {
      const firstPopulated = tabDetails.find(({ folderRows, missing }) => folderRows.length || missing.length);
      activeInlineTabId = firstPopulated?.folder.id || tabDetails[0]?.folder.id || null;
    }
    const activeTab = tabDetails.find(({ folder }) => folder.id === activeInlineTabId) || null;
    // WhatsApp has already filtered and laid out the list, so every member is reachable by scrolling.
    const nativeMode = Boolean(activeTab?.kind === "folder" && activeTab.folder.nativeList
      && WALeadFoldersClassifier.sameNativeList(nativeActive, activeTab.folder.nativeList));
    if (nativeMode) importNativeMembers(listableChats, activeTab.folder);
    const assignments = WALeadFoldersClassifier.bulkAssignments(listableChats);
    const existingMissing = new Map([...grid.querySelectorAll(":scope > .walf-inline-missing")]
      .map((row) => [row.dataset.contactId, row]));
    let tabs = grid.querySelector(":scope > .walf-inline-tabs");

    if (tabDetails.length) {
      if (!tabs) {
        tabs = document.createElement("div");
        tabs.className = "walf-inline-tabs";
        tabs.setAttribute("role", "tablist");
        tabs.setAttribute("aria-label", "Lead groups");
        tabs.addEventListener("wheel", (event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || tabs.scrollWidth <= tabs.clientWidth) return;
          event.preventDefault();
          tabs.scrollLeft += event.deltaY;
        }, { passive: false });
        tabs.addEventListener("scroll", () => syncTabOverflow(tabs), { passive: true });
        grid.append(tabs);
      }
      tabs.innerHTML = "";
      tabDetails.forEach(({ folder, missing, classified, unread, due }) => {
        const selected = folder.id === activeInlineTabId;
        const button = document.createElement("button");
        const alert = due ? { kind: "due", count: due } : unread ? { kind: "unread", count: unread } : null;
        const label = `${folder.name}, ${classified} classified chats${missing.length
          ? `, ${missing.length} outside WhatsApp's current All list` : ""}${due
          ? `, ${due} follow-up${due === 1 ? "" : "s"} due` : ""}${unread
          ? `, ${unread} chat${unread === 1 ? "" : "s"} with unread messages` : ""}`;
        button.type = "button";
        button.className = "walf-inline-tab";
        button.dataset.folderId = folder.id;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(selected));
        button.setAttribute("tabindex", selected ? "0" : "-1");
        button.setAttribute("aria-label", label);
        button.title = label;
        button.style.setProperty("--folder-color", folder.color);
        button.innerHTML = `<i aria-hidden="true"></i><b></b><span class="walf-inline-tab-total"></span><em class="walf-inline-tab-alert" aria-hidden="true"></em>`;
        button.querySelector("b").textContent = folder.name;
        button.querySelector(".walf-inline-tab-total").textContent = String(classified);
        const badge = button.querySelector(".walf-inline-tab-alert");
        badge.hidden = !alert;
        if (alert) {
          badge.dataset.kind = alert.kind;
          badge.textContent = String(alert.count);
        }
        button.addEventListener("click", () => {
          if (activeInlineTabId === folder.id) return;
          activeInlineTabId = folder.id;
          syncInlineFolders();
          void activateNativeForTab(folder.id);
          [...grid.querySelectorAll(":scope > .walf-inline-tabs [role='tab']")]
            .find((tab) => tab.dataset.folderId === activeInlineTabId)
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        button.addEventListener("keydown", (event) => {
          const key = event.key;
          if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(key)) return;
          event.preventDefault();
          const index = tabDetails.findIndex(({ folder: item }) => item.id === folder.id);
          const nextIndex = key === "Home" ? 0
            : key === "End" ? tabDetails.length - 1
              : (index + (key === "ArrowRight" || key === "ArrowDown" ? 1 : -1) + tabDetails.length) % tabDetails.length;
          activeInlineTabId = tabDetails[nextIndex].folder.id;
          syncInlineFolders();
          void activateNativeForTab(activeInlineTabId);
          [...grid.querySelectorAll(":scope > .walf-inline-tabs [role='tab']")]
            .find((tab) => tab.dataset.folderId === activeInlineTabId)?.focus();
        });
        tabs.append(button);
      });
      syncTabOverflow(tabs);
    } else {
      activeInlineTabId = null;
      tabs?.remove();
      tabs = null;
    }

    let y = 0;
    let z = rows.length + state.folders.length + 1;
    const place = (element, height) => {
      const placedY = y;
      if (element.matches("[data-testid^='list-item-']")) {
        element.style.translate = `0 ${WALeadFoldersClassifier.rowOffset(element.style.transform, y)}px`;
      } else {
        element.style.transform = `translateY(${y}px)`;
        element.style.zIndex = String(z--);
      }
      y += height;
      return placedY;
    };

    if (!nativeMode) prefix.forEach((row) => place(row, Number.parseFloat(row.style.height) || 44));
    let bulk = grid.querySelector(":scope > .walf-inline-bulk");
    if (assignments.length) {
      if (!bulk) {
        bulk = document.createElement("div");
        bulk.className = "walf-inline-bulk";
        bulk.setAttribute("role", "row");
        bulk.innerHTML = `<button type="button"><span>✦</span><b></b></button>`;
        grid.append(bulk);
      }
      bulk.querySelector("b").textContent = `Auto-group ${assignments.length} suggested chat${assignments.length === 1 ? "" : "s"}`;
      bulk.querySelector("button").onclick = () => {
        const now = Date.now();
        state.lastBulkUndo = assignments.map(({ id }) => ({
          id,
          previous: state.contacts[id] || null,
          appliedAt: now
        }));
        assignments.forEach((assignment) => {
          const chat = chats.find((item) => item.id === assignment.id) || assignment;
          upsertContact(chat, {
            folderId: assignment.folderId,
            sourceReason: chat.suggestion?.reason || "Matched auto-group rule",
            updatedAt: now
          }, "auto");
        });
        void saveState();
        toast(`${assignments.length} chat${assignments.length === 1 ? "" : "s"} grouped`);
      };
      place(bulk, 36);
    } else {
      bulk?.remove();
    }
    if (tabs) tabs.dataset.baseY = String(place(tabs, INLINE_TAB_HEIGHT));

    if (nativeMode) {
      const stripHeight = y;
      const nativeHeight = nativeListHeight(grid, rows);
      [...prefix, ...listableChats.map(({ row }) => row)]
        .forEach((row) => { row.style.translate = `0 ${stripHeight}px`; });
      y = stripHeight + nativeHeight;
    }
    const activeRows = new Set(nativeMode ? listableChats : activeTab?.folderRows || []);
    listableChats.forEach((chat) => {
      if (!activeRows.has(chat)) chat.row.classList.add("walf-inline-hidden");
    });
    let empty = grid.querySelector(":scope > .walf-inline-empty");
    let emptyPlaced = false;
    let section = grid.querySelector(":scope > .walf-inline-section");
    let sectionPlaced = false;
    if (activeTab) {
      const { folderRows, kind } = activeTab;
      // In WhatsApp-list mode only leads not yet added to that list need surfacing.
      const missing = nativeMode
        ? activeTab.missing.filter((contact) => !WALeadFoldersClassifier.sameNativeList(contact.nativeSynced, activeTab.folder.nativeList))
        : activeTab.missing;
      if (!nativeMode) folderRows.forEach(({ row }) => place(row, Number.parseFloat(row.style.height) || 76));
      if (missing.length) {
        if (!section) {
          section = document.createElement("div");
          section.className = "walf-inline-section";
          section.setAttribute("role", "row");
          section.innerHTML = `<span></span><b></b><button type="button" class="walf-inline-section-action"></button>`;
          grid.append(section);
        }
        section.querySelector("span").textContent = nativeMode ? "Not in the WhatsApp list yet"
          : folderRows.length ? "Not in recent chats" : "Saved leads";
        section.querySelector("b").textContent = String(missing.length);
        section.title = nativeMode
          ? "Open a lead to add it to this WhatsApp list automatically."
          : "Saved in this group but not loaded in WhatsApp's chat list. Click one to open it.";
        const action = section.querySelector("button");
        const sectionFolder = activeTab.kind === "folder" ? activeTab.folder : null;
        action.hidden = !sectionFolder || Boolean(batchSync);
        action.textContent = sectionFolder?.nativeList ? `Add all to ${sectionFolder.nativeList}` : "Link a WhatsApp list";
        action.onclick = () => {
          if (sectionFolder?.nativeList) void syncFolderToNativeList(sectionFolder);
          else openPanel();
        };
        place(section, 40);
        sectionPlaced = true;
        missing.forEach((contact) => {
          let row = existingMissing.get(contact.id);
          if (!row) {
            row = document.createElement("div");
            row.className = "walf-inline-missing";
            row.dataset.contactId = contact.id;
            row.setAttribute("role", "row");
            row.innerHTML = `<button type="button"><span class="walf-inline-missing-avatar" aria-hidden="true"></span><span class="walf-inline-missing-copy"><b></b><em></em></span></button>`;
            grid.append(row);
          }
          existingMissing.delete(contact.id);
          row.style.setProperty("--folder-color", activeTab.folder.color);
          row.querySelector("b").textContent = contact.name;
          row.querySelector(".walf-inline-missing-avatar").textContent = String(contact.name || "?").trim().slice(0, 1).toLocaleUpperCase();
          row.querySelector("button").setAttribute("aria-label", contact.name);
          const phone = contactPhone(contact);
          const conversation = Object.values(whatsappIndex).some((record) => record.conversation
            && ((phone && record.phone === phone)
              || WALeadFoldersClassifier.normalizedName(record.name)
                === WALeadFoldersClassifier.normalizedName(contact.name)));
          row.querySelector("em").textContent = conversation ? "WhatsApp conversation" : "Saved lead";
          row.querySelector("button").onclick = () => openSavedContact(contact);
          place(row, INLINE_MISSING_ROW_HEIGHT);
        });
      } else if (!nativeMode && !folderRows.length) {
        if (!empty) {
          empty = document.createElement("div");
          empty.className = "walf-inline-empty";
          empty.setAttribute("role", "row");
          grid.append(empty);
        }
        empty.textContent = kind === "unassigned" ? "No unassigned chats"
          : kind === "review" ? "No chats need review" : "No chats in this group yet";
        place(empty, 44);
        emptyPlaced = true;
      }
    }
    if (!emptyPlaced) empty?.remove();
    if (!sectionPlaced) section?.remove();
    existingMissing.forEach((row) => row.remove());
    grid.style.minHeight = `${y}px`;
    if (tabs) syncStickyTabs(grid, tabs);
  }

  function insertQuickReply(reply) {
    const editor = document.querySelector("#main footer [contenteditable='true'][role='textbox'], #main footer [contenteditable='true'][data-tab]");
    if (!editor) {
      toast("Open the message composer first");
      return;
    }
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("insertText", false, reply)) toast("Could not insert the quick reply");
  }

  function syncQuickReplyButton() {
    const chat = activeChat();
    const contact = savedContact(chat);
    const folder = contact && state.folders.find((item) => item.id === contact.folderId);
    const replies = folder ? state.replySequences[folder.id]
      || (state.quickReplies[folder.id] ? [state.quickReplies[folder.id]] : []) : [];
    const footer = document.querySelector("#main footer");
    let bar = root.querySelector(".walf-quick-replies");
    if (!replies.length || !footer) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "walf-quick-replies";
      root.append(bar);
    }
    const signature = `${folder.id}|${replies.join("|")}|${contact.replyStep || 0}`;
    if (bar.dataset.signature !== signature) {
      bar.dataset.signature = signature;
      bar.replaceChildren();
      replies.forEach((reply, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = index === (contact.replyStep || 0) % replies.length ? "is-next" : "";
        button.textContent = replies.length === 1 ? `↩ ${folder.name}` : `Reply ${index + 1}`;
        button.title = reply;
        button.onclick = async () => {
          insertQuickReply(reply);
          contact.replyStep = (index + 1) % replies.length;
          contact.updatedAt = Date.now();
          await saveState();
          syncQuickReplyButton();
        };
        bar.append(button);
      });
    }
    const box = footer.getBoundingClientRect();
    bar.style.left = `${Math.max(box.left + 12, box.right - 260)}px`;
    bar.style.top = `${Math.max(8, box.top - 38)}px`;
  }

  function openPanel() {
    panel.hidden = false;
    const sideLeft = document.querySelector("#side")?.getBoundingClientRect().left;
    document.querySelectorAll("button[aria-pressed='true']").forEach((button) => {
      if (button !== launcher && button.getBoundingClientRect().right <= sideLeft) {
        button.parentElement.classList.add("walf-native-selection-suppressed");
      }
    });
    launcher.classList.add("is-selected");
    launcher.setAttribute("aria-pressed", "true");
    renderPanel();
  }

  function closePanel() {
    panel.hidden = true;
    document.querySelectorAll(".walf-native-selection-suppressed")
      .forEach((element) => element.classList.remove("walf-native-selection-suppressed"));
    launcher.classList.remove("is-selected");
    launcher.setAttribute("aria-pressed", "false");
  }

  function closePanelOnNativeNavigation(event) {
    const button = event.target.closest?.("button");
    const side = document.querySelector("#side");
    if (!button || button === launcher || !side || panel.hidden) return;
    if (button.getBoundingClientRect().right <= side.getBoundingClientRect().left) closePanel();
  }

  async function handleTriageKey(event) {
    if (!triageMode || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    const key = event.key.toLocaleLowerCase();
    if (key === "n") {
      event.preventDefault();
      openNextTriageChat();
      return;
    }
    if (key === "q") {
      const nextReply = root?.querySelector(".walf-quick-replies .is-next")
        || root?.querySelector(".walf-quick-replies button");
      if (nextReply) {
        event.preventDefault();
        nextReply.click();
      }
      return;
    }
    const chat = activeChat();
    if (!chat) return;
    if (key === "f") {
      const contact = savedContact(chat);
      if (!contact) return toast("Assign this lead before scheduling follow-up");
      event.preventDefault();
      const hours = state.autoFollowUpHours || 24;
      await saveNativeLead({ ...chat, leadText: visibleConversationText() }, {
        folderId: contact.folderId,
        remindAt: localDateTime(Date.now() + hours * 3600000)
      });
      setTimeout(openNextTriageChat, 120);
      return;
    }
    const index = Number.parseInt(key, 10) - 1;
    const folder = visibleFolders()[index];
    if (!folder || index < 0) return;
    event.preventDefault();
    await saveNativeLead({ ...chat, leadText: visibleConversationText() }, { folderId: folder.id });
    setTimeout(openNextTriageChat, 120);
  }

  async function mount() {
    if (extensionContextInvalidated || root || !document.querySelector("#side")) return;
    await loadState();
    if (!state || extensionContextInvalidated) return;

    root = document.createElement("div");
    root.id = "wa-lead-folders";
    root.innerHTML = `
      <button class="walf-launcher" type="button" aria-label="Lead tools" aria-pressed="false" title="Lead tools">
        <svg class="walf-lead-folder-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 7.25A1.75 1.75 0 0 1 5.25 5.5h4.1l2 2h7.4a1.75 1.75 0 0 1 1.75 1.75v9.25H3.5z"/>
          <circle cx="12" cy="12" r="1.75"/>
          <path d="M8.75 17c.65-1.8 1.72-2.7 3.25-2.7s2.6.9 3.25 2.7"/>
        </svg>
        <span class="walf-launcher-count">0</span>
      </button>
      <aside class="walf-panel" aria-label="Lead tools" hidden></aside>
      <div class="walf-toast" role="status" aria-live="polite"></div>
    `;
    document.body.append(root);
    panel = root.querySelector(".walf-panel");
    launcher = root.querySelector(".walf-launcher");
    launcher.querySelector("span").textContent = Object.keys(state.contacts).length;
    launcher.addEventListener("click", () => panel.hidden ? openPanel() : closePanel());
    document.addEventListener("click", closePanelOnNativeNavigation, true);
    positionUi();
    syncLauncherRail();
    detectTheme();
    syncInlineFolders();
    await syncWhatsAppIndex();
    syncNativeLeadTools();
    syncContactInfoCopy();
    syncQuickReplyButton();
  }

  window.addEventListener("resize", positionUi);
  document.addEventListener("keydown", handleTriageKey);
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== "local") return;
    if (changes[QUICK_OPEN_KEY]) {
      pendingQuickOpen = latestQuickOpen(changes[QUICK_OPEN_KEY].newValue);
    }
    if (changes[STORAGE_KEY] && state) {
      if (ignoreStorageEcho) return;
      state = normalizeState(changes[STORAGE_KEY].newValue);
      if (panel && !panel.hidden) renderPanel();
      if (launcher) launcher.querySelector(".walf-launcher-count").textContent = Object.keys(state.contacts).length;
      syncInlineFolders();
      syncNativeLeadTools();
      syncQuickReplyButton();
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "WALF_OPEN_PANEL" || !root) return;
    if (panel.hidden) openPanel();
    sendResponse({ ok: true });
  });
  refreshTimer = setInterval(async () => {
    try {
      await mount();
      if (!root || extensionContextInvalidated) return;
      positionUi();
      syncLauncherRail();
      detectTheme();
      syncInlineFolders();
      await syncWhatsAppIndex();
      if (extensionContextInvalidated) return;
      syncNativeLeadTools();
      syncContactInfoCopy();
      syncQuickReplyButton();
      rememberNativeListNames(NativeLists.listNames());
      if (!batchSync) void syncActiveChatNativeList();
      launcher.querySelector(".walf-launcher-count").textContent = Object.keys(state.contacts).length;
    } catch (error) {
      if (!handleExtensionContextError(error)) console.error("WA Lead Folders sync failed", error);
    }
  }, 800);
})();
