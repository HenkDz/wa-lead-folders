(function (root) {
  const rules = [
    {
      folderId: "producer",
      folderName: "Producers",
      reason: "Producer, manufacturer, factory, or importer wording",
      patterns: [
        /producer|manufacturer|factory|importer|producteur|fabricant|usine|importateur|مستورد|مصن[ّ]?ع/i,
        /(?:مستورد|importer|importateur)\s*(?:أو|or|ou)\s*(?:مصن[ّ]?ع|manufacturer|factory|fabricant|usine)/i
      ]
    },
    {
      folderId: "wholesale",
      reason: "High-volume or wholesale wording",
      patterns: [
        /wholesale|wholesaler|distributor|distributeur|grossiste|revendeur|vente en gros/i,
        /موز[ّ]?ع|تاجر\s*(?:جملة|بالجملة)|بيع\s*بالجملة/,
        /(?:more than|over|plus de|supérieur à)\s*100/i,
        /(?:أكثر|اكثر)\s*من\s*100/,
        /(?:from|من)\s*100\s*(?:to|إلى|الى|-)\s*\d+/i
      ]
    },
    {
      folderId: "retail",
      reason: "Retail or lower-volume wording",
      patterns: [
        /retail|retailer|détaillant|detaillant|boutique|magasin|point de vente/i,
        /محل\s*بيع\s*بالتجزئة|تاجر\s*تجزئة|بالتجزئة/,
        /(?:less than|under|moins de|inférieur à)\s*100/i,
        /(?:أقل|اقل)\s*من\s*100/
      ]
    },
    {
      folderId: "irrelevant",
      folderName: "Irrelevant",
      reason: "Service-only or non-goods activity",
      patterns: [
        /خدمات\s*بدون\s*سلع/,
        /services?\s+without\s+goods/i,
        /sans\s+marchandises/i,
        /prestation[s]?\s+de\s+services?/i,
        /services?\s+only/i
      ]
    }
  ];

  const SYSTEM_FOLDERS = [
    { id: "unknown", name: "Unknown", color: "#9aa3ad" },
    { id: "irrelevant", name: "Irrelevant", color: "#9a7b73" }
  ];

  function folderByIdOrName(folders, id, name) {
    return (folders || []).find((item) => item.id === id
      || (name && normalizedName(item.name) === normalizedName(name)));
  }

  function ensureSystemFolders(folders = []) {
    const next = Array.isArray(folders) ? folders.slice() : [];
    const ids = new Set(next.map((folder) => folder?.id));
    const names = new Set(next.map((folder) => normalizedName(folder?.name)));
    SYSTEM_FOLDERS.forEach((folder) => {
      if (ids.has(folder.id) || names.has(normalizedName(folder.name))) return;
      next.push({ ...folder, hidden: false });
    });
    return next;
  }

  function classifyLead(text, folders = [], customRules = {}) {
    const candidates = new Map();
    const addScore = (folderId, score, reason) => {
      if (!folderId || !score) return;
      const previous = candidates.get(folderId) || { folderId, score: 0, reasons: [] };
      previous.score += score;
      if (reason) previous.reasons.push(reason);
      candidates.set(folderId, previous);
    };

    rules.forEach((rule) => {
      const folder = folderByIdOrName(folders, rule.folderId, rule.folderName);
      if (rule.folderName && !folder) return;
      addScore(folder?.id || rule.folderId, rule.patterns.filter((pattern) => pattern.test(text)).length, rule.reason);
    });

    const normalizedText = normalizedName(text);
    Object.entries(customRules || {}).forEach(([folderId, phrases]) => {
      const folder = folders.find((item) => item.id === folderId);
      if (!folder || !Array.isArray(phrases)) return;
      const score = phrases.filter((phrase) => {
        const normalizedPhrase = normalizedName(phrase);
        return normalizedPhrase && normalizedText.includes(normalizedPhrase);
      }).length;
      addScore(folderId, score, `Matched ${folder.name} rule`);
    });

    const irrelevantFolder = folderByIdOrName(folders, "irrelevant", "Irrelevant");
    const irrelevant = irrelevantFolder && candidates.get(irrelevantFolder.id);
    if (irrelevant?.score) {
      return { folderId: irrelevant.folderId, reason: irrelevant.reasons.join("; ") };
    }

    const scores = [...candidates.values()]
      .filter((item) => item.folderId !== irrelevantFolder?.id)
      .sort((a, b) => b.score - a.score);
    if (scores[0]?.score && scores[0].score !== scores[1]?.score) {
      return { folderId: scores[0].folderId, reason: scores[0].reasons.join("; ") };
    }

    const unknown = folderByIdOrName(folders, "unknown", "Unknown");
    return unknown ? { folderId: unknown.id, reason: "No folder signal" } : null;
  }

  function rememberedLeadSuggestion(live, saved, folders = []) {
    const allowed = new Set((folders || []).map((folder) => folder?.id).filter(Boolean));
    const usable = (suggestion) => suggestion?.folderId && (!allowed.size || allowed.has(suggestion.folderId));
    if (usable(live)) return live;
    if (usable(saved)) return saved;
    return null;
  }

  function rememberedLeadScore(live, saved) {
    if (!live) return saved || null;
    if (!saved) return live;
    return Number(live.points || 0) >= Number(saved.points || 0) ? live : saved;
  }

  function planInlineFolders(rows, folders) {
    const grouped = new Set();
    const groups = folders.map((folder) => {
      const matches = rows.filter((row) => row.folderId === folder.id);
      matches.forEach((row) => grouped.add(row));
      return matches.length ? { folder, rows: matches } : null;
    }).filter(Boolean);

    return { groups, ungrouped: rows.filter((row) => !grouped.has(row)) };
  }

  function bulkAssignments(rows) {
    return rows.filter((row) => !row.folderId && row.suggestion)
      .map(({ id, name, suggestion }) => ({ id, name, folderId: suggestion.folderId }));
  }

  function hasUnread(text, ariaLabel = "") {
    const count = Number.parseInt(text || ariaLabel, 10);
    return Number.isFinite(count) && count > 0;
  }

  function validatedFolderName(input, folders, currentId = null) {
    const name = input?.trim().slice(0, 40);
    if (!name) return null;
    const duplicate = folders.some((folder) => folder.id !== currentId
      && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    return duplicate ? null : name;
  }

  function normalizedPhone(value) {
    const text = value?.trim();
    if (!/^\+?[\d\s().-]{8,}$/.test(text || "")) return null;
    let digits = text.replace(/\D/g, "");
    if (digits.length < 8) return null;
    if (/^00213/.test(digits)) digits = digits.slice(2);
    // Forms often keep the local 0 after +213: +2130555... → +213555...
    if (/^2130\d{9,}$/.test(digits)) digits = `213${digits.slice(4)}`;
    // Algeria is 213 + 9 digits. Trailing junk (unread "1", extra form digits) is dropped.
    if (/^213\d{9,}$/.test(digits)) digits = digits.slice(0, 12);
    if (text.startsWith("+") || /^213\d{9}$/.test(digits)) return `+${digits}`;
    if (/^0\d{9}$/.test(digits)) return `+213${digits.slice(1)}`;
    return digits;
  }

  function whatsAppWebUrl(phone, action = "message") {
    const normalized = normalizedPhone(phone);
    if (!normalized) return null;
    const type = action === "call" ? "call" : "phone_number";
    return `https://web.whatsapp.com/send/?phone=${normalized.replace(/\D/g, "")}&text&type=${type}&app_absent=0`;
  }

  function normalizedName(value) {
    return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
      .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  function fieldValue(text, labels) {
    const wanted = labels.map(normalizedName);
    for (const line of String(text || "").split(/\r?\n/)) {
      const separator = line.search(/[:：]/);
      if (separator < 0) continue;
      const label = normalizedName(line.slice(0, separator));
      if (wanted.some((item) => label === item || label.includes(item))) {
        return line.slice(separator + 1).trim() || null;
      }
    }
    return null;
  }

  function structuredLeadFields(text) {
    const fullName = fieldValue(text, ["Full name", "Nom complet", "الاسم الكامل"]);
    const rawPhone = fieldValue(text, ["Phone number", "Telephone", "Numéro de téléphone", "رقم الهاتف"])
      || text?.match(/(?:^|\n)\s*Phone number:\s*(\+?[\d ().-]{8,24})/i)?.[1];
    return {
      fullName: fullName || null,
      phone: normalizedPhone(rawPhone),
      company: fieldValue(text, ["Company name", "Nom de l'entreprise", "اسم الشركة"]),
      activity: fieldValue(text, ["Activity", "Business type", "Type d'activité", "ما نوع نشاطك"]),
      volume: fieldValue(text, ["Orders per month", "Number of orders", "Nombre de commandes", "كم عدد الطلبات", "عدد الطلبات"]),
      campaign: fieldValue(text, ["Campaign", "Campaign name", "Ad name", "Nom de la campagne"])
    };
  }

  function metaLeadFields(text) {
    const { fullName, phone } = structuredLeadFields(text);
    return { fullName, phone };
  }

  function usernamesIn(value) {
    return [...new Set([...String(value || "").matchAll(/@([a-z][a-z0-9._]{2,29})\b/gi)]
      .map((match) => match[1].toLowerCase().replace(/\.+$/g, "")))];
  }

  function normalizedUsername(value) {
    const text = String(value || "").trim();
    if (text.toLowerCase().startsWith("username:")) return normalizedUsername(`@${text.slice(9)}`);
    const handles = usernamesIn(text.startsWith("@") ? text : ` ${text}`);
    return handles[0] || null;
  }

  function phoneInText(value) {
    const text = String(value || "");
    const jid = text.match(/(\d{8,15})@(?:c\.us|s\.whatsapp\.net)/i);
    if (jid) {
      const fromJid = normalizedPhone(jid[1]) || (jid[1].length >= 8 ? `+${jid[1]}` : null);
      if (fromJid) return fromJid;
    }
    const patterns = [
      /\+213[\s.-]*0?(?:[\s.-]*\d){9}(?!\d)/,
      /\b0\d{9}\b/,
      /\+\d(?:[\s().-]*\d){7,14}(?!\d)/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const phone = match && normalizedPhone(match[0]);
      if (phone) return phone;
    }
    return null;
  }

  function contactPhones(contact) {
    return new Set([
      normalizedPhone(contact?.phone),
      normalizedPhone(contact?.name),
      contact?.id?.startsWith("phone:") ? normalizedPhone(contact.id.slice(6)) : null
    ].filter(Boolean));
  }

  function contactUsernames(contact) {
    const handles = new Set();
    const add = (value) => {
      if (!value) return;
      const text = String(value);
      if (text.toLowerCase().startsWith("username:")) {
        const handle = text.slice(9).toLowerCase();
        if (/^[a-z][a-z0-9._]{2,29}$/.test(handle)) handles.add(handle);
        return;
      }
      usernamesIn(text).forEach((handle) => handles.add(handle));
    };
    add(contact?.username && (String(contact.username).includes("@") ? contact.username : `@${contact.username}`));
    add(contact?.id);
    add(contact?.name);
    (contact?.aliases || []).forEach(add);
    return handles;
  }

  function contactNames(contact) {
    return new Set([contact?.name, ...(contact?.aliases || [])].map(normalizedName).filter(Boolean));
  }

  function contactIdentity(contact) {
    const phone = normalizedPhone(contact?.phone)
      || normalizedPhone(contact?.name)
      || (contact?.id?.startsWith("phone:") ? normalizedPhone(contact.id.slice(6)) : null);
    if (phone) return `phone:${phone.replace(/\D/g, "")}`;
    const username = normalizedUsername(contact?.username)
      || usernamesIn(contact?.name)[0]
      || (contact?.id?.startsWith("username:") ? contact.id.slice(9) : null);
    return username ? `username:${username}` : `name:${normalizedName(contact?.name)}`;
  }

  function duplicateContactGroups(contacts) {
    const groups = new Map();
    Object.values(contacts || {}).forEach((contact) => {
      const key = contactIdentity(contact);
      if (!key || key === "name:") return;
      const group = groups.get(key) || [];
      group.push(contact);
      groups.set(key, group);
    });
    return [...groups.entries()].filter(([, group]) => group.length > 1)
      .map(([identity, group]) => ({ identity, contacts: group }));
  }

  function matchingContact(contacts, chat, knownPhone = null) {
    if (!chat) return null;
    const chatPhone = normalizedPhone(knownPhone) || normalizedPhone(chat.phone) || normalizedPhone(chat.name)
      || (chat.id?.startsWith("phone:") ? normalizedPhone(chat.id.slice(6)) : null)
      || phoneInText(chat.name);
    const chatUser = normalizedUsername(chat.username)
      || usernamesIn(chat.name)[0]
      || (chat.id?.startsWith("username:") ? chat.id.slice(9).toLowerCase() : null);
    const chatName = normalizedName(chat.name);
    const compatible = (contact) => {
      const phones = contactPhones(contact);
      return !chatPhone || !phones.size || phones.has(chatPhone);
    };

    const direct = contacts?.[chat.id];
    if (direct && compatible(direct)) return direct;

    if (chatPhone) {
      const byId = contacts[`phone:${chatPhone.replace(/\D/g, "")}`];
      if (byId && compatible(byId)) return byId;
    }

    const list = Object.values(contacts || {}).filter(compatible);
    if (chatPhone) {
      const byPhone = list.filter((contact) => contactPhones(contact).has(chatPhone));
      if (byPhone.length === 1) return byPhone[0];
    }
    if (chatUser) {
      const byUser = list.filter((contact) => contactUsernames(contact).has(chatUser));
      if (byUser.length === 1) return byUser[0];
    }
    if (chatName) {
      const byName = list.filter((contact) => contactNames(contact).has(chatName));
      if (byName.length === 1) return byName[0];
    }
    return null;
  }

  function rowOffset(nativeTransform, desiredY) {
    const nativeY = Number.parseFloat(/translateY\(([-\d.]+)px\)/.exec(nativeTransform || "")?.[1]) || 0;
    return desiredY - nativeY;
  }

  function followUpBucket(remindAt, now = Date.now()) {
    if (!remindAt || !Number.isFinite(Date.parse(remindAt))) return "none";
    const date = new Date(now);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const end = start + 86400000;
    const reminder = Date.parse(remindAt);
    if (reminder < start) return "overdue";
    if (reminder < end) return "today";
    return "waiting";
  }

  function whatsAppMessageTime(label) {
    const match = String(label || "").match(/^\[(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]/);
    if (!match) return null;
    const [, hour, minute, day, month, year] = match.map(Number);
    const time = new Date(year, month - 1, day, hour, minute).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function metaMatchStatus(messenger, whatsappRecords) {
    const phoneMatches = messenger?.phone
      ? whatsappRecords.filter((record) => record.phone === messenger.phone) : [];
    const byPhone = phoneMatches.find((record) => record.conversation)
      || phoneMatches.find((record) => record.hasWa) || phoneMatches[0];
    if (byPhone?.conversation) return { status: "linked", match: byPhone };
    if (byPhone?.hasWa) return { status: "available", match: byPhone };
    if (byPhone) return { status: "saved", match: byPhone };
    const byName = whatsappRecords.find((record) => normalizedName(record.name) === normalizedName(messenger?.name));
    if (byName) return { status: "possible", match: byName };
    return { status: messenger?.phone ? "unmatched" : "unknown", match: null };
  }

  function metaThreadUrl(currentUrl, route) {
    if (!route?.threadId) return null;
    const url = new URL(currentUrl);
    url.searchParams.set("selected_item_id", route.threadId);
    url.searchParams.set("thread_type", route.threadType || "FB_MESSAGE");
    if (route.mailboxId) url.searchParams.set("mailbox_id", route.mailboxId);
    return url.href;
  }

  function isLeadForm(text) {
    return /company name:|full name:|phone number:|orders? per month|nombre de commandes|اسم الشركة|الاسم الكامل|رقم الهاتف|عدد الطلبات/i.test(text);
  }

  function scoreLead(text) {
    if (!isLeadForm(text)) return null;
    let points = 0;
    if (/wholesale|wholesaler|distributor|grossiste|vente en gros|موز[ّ]?ع|تاجر\s*(?:جملة|بالجملة)|بيع\s*بالجملة/i.test(text)) points += 2;
    if (/(?:more than|over|plus de|supérieur à|أكثر|اكثر)\s*100|(?:from|من)\s*100\s*(?:to|إلى|الى|-)\s*\d+/i.test(text)) points += 2;
    if (/\bnow\b|maintenant|الآن|الان/i.test(text)) points += 2;
    if (/within (?:a )?month|dans un mois|خلال شهر/i.test(text)) points += 1;
    if (/just (?:looking|exploring)|je (?:regarde|découvre)|فقط (?:أستكشف|استكشف)/i.test(text)) points -= 2;
    const level = points >= 4 ? "hot" : points >= 2 ? "warm" : "cold";
    return { points, level, label: level[0].toUpperCase() + level.slice(1) };
  }

  function isValidBackupState(value) {
    if (!value || !Array.isArray(value.folders)
      || !value.folders.every((folder) => folder && folder.id && folder.name
        && typeof folder.id === "string" && typeof folder.name === "string" && typeof folder.color === "string"
        && (folder.hidden === undefined || typeof folder.hidden === "boolean"))
      || !value.contacts || typeof value.contacts !== "object" || Array.isArray(value.contacts)) return false;
    const folderIds = new Set(value.folders.map((folder) => folder.id));
    return folderIds.size === value.folders.length
      && Object.values(value.contacts).every((contact) => contact && typeof contact.id === "string"
        && typeof contact.name === "string" && folderIds.has(contact.folderId));
  }

  root.WALeadFoldersClassifier = {
    classifyLead, ensureSystemFolders, rememberedLeadSuggestion, rememberedLeadScore, planInlineFolders, bulkAssignments, hasUnread, validatedFolderName,
    normalizedPhone, phoneInText, whatsAppWebUrl, normalizedName, normalizedUsername, usernamesIn,
    metaLeadFields, structuredLeadFields,
    metaMatchStatus, metaThreadUrl, contactIdentity, duplicateContactGroups, matchingContact, rowOffset,
    followUpBucket, whatsAppMessageTime,
    isLeadForm, scoreLead, isValidBackupState
  };
  if (typeof module !== "undefined") module.exports = root.WALeadFoldersClassifier;
})(typeof globalThis !== "undefined" ? globalThis : this);
