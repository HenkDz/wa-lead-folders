const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  classifyLead, ensureSystemFolders, rememberedLeadSuggestion, rememberedLeadScore, planInlineFolders, bulkAssignments, hasUnread, validatedFolderName,
  normalizedPhone, whatsAppWebUrl, normalizedName, metaLeadFields, metaMatchStatus, metaThreadUrl,
  structuredLeadFields, contactIdentity, duplicateContactGroups, matchingContact, rowOffset, followUpBucket,
  phoneInText, normalizedUsername, usernamesIn,
  whatsAppMessageTime, isLeadForm, scoreLead, isValidBackupState,
  chatJidFromMessageId, jidPhone, sameNativeList, guessNativeList
} = require("../classifier.js");

test("normalizes only usable phone numbers", () => {
  assert.equal(normalizedPhone("+213 555 01 01 01"), "+213555010101");
  assert.equal(normalizedPhone("0555-12-34-56"), "+213555123456");
  assert.equal(normalizedPhone("0555 01 02 02"), normalizedPhone("+213555010202"));
  assert.equal(normalizedPhone("00213 555 010 202"), "+213555010202");
  assert.equal(normalizedPhone("+2130555010303"), "+213555010303");
  assert.equal(normalizedPhone("+213 055 501 03 03"), normalizedPhone("+213 555 01 03 03"));
  assert.equal(normalizedPhone("+2135550104041"), "+213555010404");
  assert.equal(normalizedPhone("+213 555 01 04 04 1"), "+213555010404");
  assert.equal(normalizedPhone("islam"), null);
});

test("does not merge ambiguous same-name contacts or overwrite a different phone", () => {
  const contacts = {
    "phone:213555000001": { id: "phone:213555000001", name: "Same Name", phone: "+213555000001" },
    "phone:213555000002": { id: "phone:213555000002", name: "Same Name", phone: "+213555000002" }
  };
  assert.equal(matchingContact(contacts, { id: "name:same name", name: "Same Name" }), null);
  assert.equal(matchingContact(contacts, { id: "name:same name", name: "Same Name" }, "+213555000002").id,
    "phone:213555000002");
  assert.equal(matchingContact({
    "phone:213555010505": { id: "phone:213555010505", name: "Lead", phone: "+213555010505" }
  }, { id: "phone:0555010505", name: "0555 01 05 05" }).id, "phone:213555010505");
  assert.equal(matchingContact({
    "phone:213555000001": {
      id: "phone:213555000001",
      name: "+213 555 000 001",
      phone: "+213555000001",
      aliases: ["+213 555 000 001", "VIP Lead"],
      folderId: "vip"
    }
  }, { id: "name:vip lead", name: "VIP Lead" }).id, "phone:213555000001");
  assert.equal(matchingContact({
    "phone:213555000001": {
      id: "phone:213555000001",
      name: "Alice",
      phone: "+213555000001",
      username: "alice",
      aliases: ["@alice"]
    }
  }, { id: "username:alice", name: "@alice", username: "alice" }).id, "phone:213555000001");
  assert.equal(matchingContact({
    "phone:2130555010303": {
      id: "phone:2130555010303",
      name: "Sample Lead",
      phone: "+2130555010303",
      folderId: "retail"
    }
  }, { id: "phone:213555010303", name: "+213 555 01 03 03" }).id, "phone:2130555010303");
  assert.equal(phoneInText("list-item-213555000001@c.us"), "+213555000001");
  assert.equal(phoneInText("sample +213 555 01 04 04 1 unread message"), "+213555010404");
  assert.equal(normalizedUsername("Camion @alice_wa"), "alice_wa");
  assert.deepEqual(usernamesIn("Saved as @alice and @bob.ok"), ["alice", "bob.ok"]);
});

test("offsets grouped rows without replacing WhatsApp's native transform", () => {
  assert.equal(rowOffset("translateY(440px)", 212), -228);
});

test("builds direct WhatsApp Web message and call URLs", () => {
  assert.match(whatsAppWebUrl("0555 01 07 07"), /phone=213555010707.*type=phone_number/);
  assert.match(whatsAppWebUrl("0555 01 07 07", "call"), /type=call/);
  assert.equal(whatsAppWebUrl("not a phone"), null);
});

test("offers message and call actions for selected phone numbers everywhere", () => {
  const background = readFileSync(join(__dirname, "..", "background.js"), "utf8");
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("contextMenus"));
  assert.match(background, /contexts: \["selection", "link"\]/);
  assert.match(background, /"walf-message": "message"/);
  assert.match(background, /"walf-call": "call"/);
  assert.match(background, /openWhatsApp\(phone, action, true\)/);
});

test("ships one popup for quick contact and the lead desk", () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
  const popup = readFileSync(join(__dirname, "..", "popup.html"), "utf8");
  const popupScript = readFileSync(join(__dirname, "..", "popup.js"), "utf8");
  const quickContact = readFileSync(join(__dirname, "..", "quick-contact-content.js"), "utf8");
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.match(popup, /data-tab="quick"/);
  assert.match(popup, /data-tab="desk"/);
  assert.match(popupScript, /waLeadFoldersState/);
  assert.match(popupScript, /\.\.\.raw/);
  assert.match(popupScript, /WALF_OPEN_PANEL/);
  assert.match(quickContact, /WA_GET_SETTINGS/);
  assert.match(quickContact, /wa-qc-bubble/);
});

test("stops cleanly when the extension storage API disappears", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  assert.match(source, /function storageApiAvailable\(\)/);
  assert.match(source, /function stopAfterStorageUnavailable\(\)/);
  assert.match(source, /chrome\.storage\?\.onChanged\?\.addListener\?/);
});

test("builds an exact Meta Messenger thread route", () => {
  const url = metaThreadUrl("https://business.facebook.com/latest/inbox/all/?business_id=54&asset_id=11", {
    threadId: "100000174866262", threadType: "FB_MESSAGE", mailboxId: "1191703470694167"
  });
  const params = new URL(url).searchParams;
  assert.equal(params.get("business_id"), "54");
  assert.equal(params.get("selected_item_id"), "100000174866262");
  assert.equal(params.get("thread_type"), "FB_MESSAGE");
  assert.equal(params.get("mailbox_id"), "1191703470694167");
});

test("reads WhatsApp's message timestamp", () => {
  assert.equal(
    whatsAppMessageTime("[22:41, 2/8/2026] Dzdistro: "),
    new Date(2026, 7, 2, 22, 41).getTime()
  );
  assert.equal(whatsAppMessageTime("Voice message"), null);
});

test("extracts a stable Meta lead identity", () => {
  const fields = metaLeadFields("Company name: acme\nFull name: Sample Lead One\nPhone number: +213 555 010 202");
  assert.deepEqual(fields, { fullName: "Sample Lead One", phone: "+213555010202" });
  assert.equal(normalizedName("  Sámple Lead—One "), "sample lead one");
});

test("extracts structured form fields for the native lead card and export", () => {
  assert.deepEqual(structuredLeadFields([
    "Company name: Atlas Distribution",
    "Full name: Sample Lead Two",
    "Phone number: 0555 01 07 07",
    "Type d'activité: Grossiste",
    "Nombre de commandes: Plus de 100",
    "Campaign name: Summer B2B"
  ].join("\n")), {
    fullName: "Sample Lead Two",
    phone: "+213555010707",
    company: "Atlas Distribution",
    activity: "Grossiste",
    volume: "Plus de 100",
    campaign: "Summer B2B"
  });
});

test("separates WhatsApp availability from an existing conversation", () => {
  const phone = normalizedPhone("+213555010707");
  const whatsapp = [{ name: "Sample Lead Two", phone, conversation: true }];
  assert.equal(metaMatchStatus({ name: "Different profile", phone: normalizedPhone("0555 01 07 07") }, whatsapp).status, "linked");
  assert.equal(metaMatchStatus({ name: "Different profile", phone }, [{ phone, hasWa: true }]).status, "available");
  assert.equal(metaMatchStatus({ name: "Different profile", phone }, [{ phone }]).status, "saved");
  assert.equal(metaMatchStatus({ name: "Different profile", phone }, [{ phone }, { phone, conversation: true }]).status, "linked");
  assert.equal(metaMatchStatus({ name: "Sample Lead Two", phone: null }, whatsapp).status, "possible");
  assert.equal(metaMatchStatus({ name: "Sample Lead Two", phone: "0666000000" }, whatsapp).status, "possible");
  assert.equal(metaMatchStatus({ name: "Unknown", phone: "0666000000" }, whatsapp).status, "unmatched");
  assert.equal(metaMatchStatus({ name: "Unknown", phone: null }, whatsapp).status, "unknown");
});

test("scopes Meta matching to Business Inbox native rows", () => {
  const source = readFileSync(join(__dirname, "..", "meta.js"), "utf8");
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
  assert.ok(manifest.content_scripts.some((script) => script.matches.includes("https://business.facebook.com/latest/inbox/*")
    && script.js.includes("meta.js")));
  assert.match(source, /\/latest\/inbox\//);
  assert.match(source, /data-surface\$='\/lib:thread_title'/);
  assert.match(source, /img\[alt='WhatsApp'\], img\[alt='Messenger'\]/);
  assert.match(source, /Check WhatsApp/);
});

test("merges quick Message Call Copy actions into Meta Inbox", () => {
  const meta = readFileSync(join(__dirname, "..", "meta.js"), "utf8");
  const styles = readFileSync(join(__dirname, "..", "meta.css"), "utf8");
  const background = readFileSync(join(__dirname, "..", "background.js"), "utf8");
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.permissions.includes("tabs"));
  assert.match(JSON.stringify(manifest), /<all_urls>/);
  assert.match(meta, /WALF_OPEN_PHONE/);
  assert.match(meta, /add\("Message"[\s\S]*add\("Call"[\s\S]*add\("Copy"/);
  assert.match(styles, /#mbwa-phone-bubble/);
  assert.match(background, /chrome\.tabs\.query/);
  assert.match(background, /web\.whatsapp\.com\/send/);
  assert.match(background, /api\.whatsapp\.com\/send/);
});

test("shares a persistent WhatsApp identity index with Meta Inbox", () => {
  const whatsapp = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const meta = readFileSync(join(__dirname, "..", "meta.js"), "utf8");
  assert.match(whatsapp, /waLeadFoldersWhatsAppIndex/);
  assert.match(whatsapp, /Object\.values\(state\.contacts\)/);
  assert.match(whatsapp, /metaLeadFields\(leadMessage \|\| ""\)/);
  assert.match(whatsapp, /conversation: !searching/);
  assert.match(meta, /Object\.values\(whatsappIndex\)/);
  assert.match(meta, /changes\[WA_INDEX_KEY\]/);
});

test("classifies the form volume answers without guessing on conflicts", () => {
  const folders = [{ id: "custom-producers", name: "Producers" }];
  assert.equal(classifyLead("ما نوع نشاطك؟: مستورد أو مصنع", folders).folderId, "custom-producers");
  assert.equal(classifyLead("ما نوع نشاطك؟: مستورد أو مصنع"), null);
  assert.equal(classifyLead("Orders per month: أكثر من 100").folderId, "wholesale");
  assert.equal(classifyLead("Nombre de commandes: أقل من 100").folderId, "retail");
  assert.equal(classifyLead("Je suis grossiste et distributeur").folderId, "wholesale");
  assert.equal(classifyLead("ما نوع نشاطك؟: موزّع أو تاجر جملة").folderId, "wholesale");
  assert.equal(classifyLead("ما نوع نشاطك؟: محل بيع بالتجزئة").folderId, "retail");
  assert.equal(classifyLead("Retail shop, more than 100 orders"), null);
  assert.equal(classifyLead("Hello, I filled in your form"), null);
  assert.equal(classifyLead("Company name: Facebook\nكم عدد الطلبات أو الفواتير في الشهر؟: من 100 إلى 500\nما نوع نشاطك؟: موزع أو تاجر جملة\nPhone number: +213555099110").folderId, "wholesale");
  const systemFolders = ensureSystemFolders([
    { id: "wholesale", name: "Wholesalers" },
    { id: "retail", name: "Retailers" }
  ]);
  assert.equal(classifyLead("ما نوع نشاطك؟: خدمات بدون سلع\nكم عدد الطلبات أو الفواتير في الشهر؟: من 100 إلى 500", systemFolders).folderId, "irrelevant");
  assert.equal(classifyLead("Activity: services without goods", systemFolders).folderId, "irrelevant");
  assert.equal(classifyLead("Waiting for this message. Check your phone.", systemFolders).folderId, "unknown");
  assert.equal(classifyLead("Hello, I filled in your form", systemFolders).folderId, "unknown");
  assert.deepEqual(systemFolders.map((folder) => folder.id).slice(-2), ["unknown", "irrelevant"]);
});

test("uses editable folder phrases without overriding ambiguous matches", () => {
  const folders = [{ id: "custom-importers", name: "Importers" }, { id: "retail", name: "Retailers" }];
  const customRules = { "custom-importers": ["exclusive importer", "مستورد حصري"] };
  assert.equal(classifyLead("Activity: exclusive importer", folders, customRules).folderId, "custom-importers");
  assert.equal(classifyLead("exclusive importer retail shop", folders, customRules), null);
});

test("finds duplicate contact identities and buckets follow-ups", () => {
  const phone = "+213555010101";
  const contacts = {
    a: { id: "name:islam", name: "Islam", phone },
    b: { id: "phone:213555010101", name: phone },
    c: { id: "name:other", name: "Other" }
  };
  assert.equal(contactIdentity(contacts.a), "phone:213555010101");
  assert.deepEqual(duplicateContactGroups(contacts).map(({ contacts: matches }) => matches.length), [2]);
  const now = new Date(2026, 7, 2, 12).getTime();
  assert.equal(followUpBucket(new Date(2026, 7, 1, 12).toISOString(), now), "overdue");
  assert.equal(followUpBucket(new Date(2026, 7, 2, 18).toISOString(), now), "today");
  assert.equal(followUpBucket(new Date(2026, 7, 3, 12).toISOString(), now), "waiting");
});

test("uses in-page forms, triage queues, reply sequences, and Meta outcomes", () => {
  const whatsapp = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const meta = readFileSync(join(__dirname, "..", "meta.js"), "utf8");
  assert.match(whatsapp, /function openFormDialog/);
  assert.doesNotMatch(whatsapp, /\b(?:prompt|confirm|alert)\s*\(/);
  assert.match(whatsapp, /replySequences/);
  assert.match(whatsapp, /folderRules/);
  assert.match(whatsapp, /handleTriageKey/);
  assert.match(whatsapp, /duplicateContactGroups/);
  assert.match(meta, /const OUTCOMES/);
  assert.match(meta, /openNextMetaLead/);
  assert.match(meta, /mbwa-outcome/);
});

test("persists a Meta review queue beyond the current virtualized window", () => {
  const whatsapp = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const meta = readFileSync(join(__dirname, "..", "meta.js"), "utf8");
  assert.match(meta, /review: \{\}/);
  assert.match(meta, /function rememberReviewRows/);
  assert.match(meta, /function reviewEntries/);
  assert.match(meta, /function syncReviewQueue/);
  assert.match(meta, /mbwa-review-queue/);
  assert.match(meta, /function openReviewRecord/);
  assert.match(meta, /selected_item_id/);
  assert.match(meta, /thread_type/);
  assert.match(meta, /mailbox_id/);
  assert.match(meta, /location\.assign\(metaThreadUrl\(location\.href, record\)\)/);
  assert.doesNotMatch(meta, /input\[placeholder='Search'\]/);
  assert.match(meta, /function rememberReviewThread/);
  assert.match(meta, /pendingMetaSelection/);
  assert.match(meta, /sessionStorage\.setItem\(FILTER_KEY/);
  assert.doesNotMatch(meta, /function openReviewRecord[\s\S]{0,160}filterOn = false/);
  assert.match(meta, /entry\.threadId === selectedId/);
  assert.match(meta, /aria-current/);
  assert.match(meta, /queue\?\.contains\(document\.activeElement\).*HTMLSelectElement/);
  assert.match(meta, /result\.status === "linked" \|\| result\.status === "available"/);
  assert.match(meta, /looseMatches\.length === 1/);
  assert.match(whatsapp, /waLeadFoldersQuickOpened/);
  assert.match(whatsapp, /pendingQuickOpen\?\.phone/);
  assert.match(whatsapp, /conversation && requestedPhone/);
});

test("reads the chat title instead of the last-seen subtitle", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const activeChat = source.match(/function activeChat\(\) \{[\s\S]*?\n  \}/)[0];

  assert.match(activeChat, /conversation-info-header-chat-title/);
  assert.doesNotMatch(activeChat, /header\.querySelectorAll\("span\[title\]"\)/);
});

test("keeps daily actions in the WhatsApp header and the launcher panel settings-only", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const styles = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
  const nativeTools = source.match(/function syncNativeLeadTools\(\) \{[\s\S]*?\n  \}/)[0];
  const panel = source.match(/function renderPanel\(\) \{[\s\S]*?\n  \}/)[0];

  assert.match(nativeTools, /info\.after\(tools\)/);
  assert.match(nativeTools, /walf-native-score/);
  assert.match(nativeTools, /walf-native-auto-assign/);
  assert.match(nativeTools, /walf-native-folder/);
  assert.match(nativeTools, /walf-native-reminder/);
  assert.match(nativeTools, /copyPhoneButton/);
  assert.match(nativeTools, /popovertarget="walf-native-popover"/);
  assert.match(nativeTools, /id="walf-native-popover" class="walf-native-popover" popover/);
  assert.doesNotMatch(nativeTools, /popover\.(?:show|hide)Popover\(\)/);
  assert.match(nativeTools, /getBoundingClientRect\(\)/);
  assert.match(styles, /conversation-info-header.*min-width: max-content/);
  assert.match(styles, /walf-native-popover:not\(:popover-open\) \{ display: none; \}/);
  assert.match(styles, /walf-native-auto-assign/);
  assert.match(source, /contact-info-subtitle/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(panel, /Lead tools/);
  assert.doesNotMatch(panel, /SELECTED CHAT/);
  assert.doesNotMatch(panel, /walf-icon-button/);
});

test("keeps full-conversation scores and suggestions without moving the selected row", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const nativeTools = source.match(/function syncNativeLeadTools\(\) \{[\s\S]*?\n  \}/)[0];
  const inlineFolders = source.match(/function syncInlineFolders\(\) \{[\s\S]*?\n  \}/)[0];

  assert.match(source, /leadScores: value\.leadScores/);
  assert.match(source, /leadSuggestions: value\.leadSuggestions/);
  assert.match(nativeTools, /resolveLeadInsight\(chat, text, contact\)/);
  assert.match(inlineFolders, /resolveLeadInsight\(chat, leadText, contact\)/);
  assert.match(source, /function resolveLeadInsight/);
  assert.match(source, /rememberedLeadSuggestion/);
  assert.match(source, /persistLeadInsight/);
  assert.match(inlineFolders, /visibleConversationText\(\)/);
  assert.doesNotMatch(inlineFolders, /delete state\.leadSuggestions\[id\]/);
  assert.doesNotMatch(inlineFolders, /row\.style\.transform =/);
  assert.match(inlineFolders, /rowOffset\(element\.style\.transform, y\)/);
});

test("automates new follow-ups and keeps group tabs available while scrolling", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  assert.match(source, /autoFollowUpHours:[\s\S]*?: 24/);
  assert.match(source, /const remindAt = Object\.hasOwn\(changes, "remindAt"\)/);
  assert.match(source, /function completeFollowUpFromOutgoing/);
  assert.match(source, /contact\.remindAt = null/);
  assert.match(source, /pane\.addEventListener\("scroll"/);
  assert.match(source, /tabs\.dataset\.baseY/);
  assert.match(source, /syncStickyTabs\(grid, tabs\)/);
  assert.match(source, /role", "tablist"/);
  assert.match(source, /role", "tab"/);
  assert.match(source, /activeInlineTabId/);
  assert.match(source, /function persistState/);
  assert.match(source, /ignoreStorageEcho/);
  assert.doesNotMatch(source, /state\.folded/);
});

test("keeps off-list contacts visible in their active group tab", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const styles = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
  assert.match(source, /async function openSavedContact\(contact, \{ reload = true \} = \{\}\)/);
  assert.match(source, /await clearChatSearch\(\);\s+setSearchQuery\(chatSearchBox\(\) \|\| search, query\)/);
  assert.match(source, /waitForValue\(\(\) => isOpenLead\(contact\), 2500\)/);
  assert.match(source, /if \(clicked\) return false;/);
  assert.match(source, /walf-inline-missing/);
  assert.match(source, /whatsAppWebUrl\(directPhone\)/);
  assert.match(source, /const searchQueries = \[\.\.\.new Set\(\[directPhone, contact\.name\]/);
  assert.match(source, /const fallbackToDirect = \(\) =>/);
  assert.match(source, /for \(const query of searchQueries\)/);
  assert.match(source, /const phoneMatch/);
  assert.doesNotMatch(source, /const result = exact \|\| \(titles\.length === 1/);
  assert.match(source, /Saved lead/);
  assert.match(source, /WhatsApp conversation/);
  assert.match(source, /walf-inline-section/);
  assert.match(source, /Not in recent chats/);
  assert.match(source, /missing\.forEach\(\(contact\) =>/);
  assert.doesNotMatch(source, /walf-inline-missing-toggle/);
  assert.doesNotMatch(source, /expandedInlineMissing/);
  assert.match(source, /folderRows\.forEach[\s\S]*?if \(missing\.length\)/);
  assert.match(styles, /#pane-side \.walf-inline-missing/);
  assert.doesNotMatch(styles, /#pane-side \.walf-inline-missing-toggle/);
  assert.doesNotMatch(source, /<i>Open<\/i>/);
  assert.match(source, /walf-inline-missing-avatar/);
  assert.match(styles, /grid-template-columns: 49px minmax\(0, 1fr\)/);
});

test("mounts the settings launcher in WhatsApp's utility rail", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const styles = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
  assert.match(source, /function syncLauncherRail\(\)/);
  assert.match(source, /walf-lead-folder-icon/);
  assert.match(source, /<circle cx="12" cy="12" r="1\.75"/);
  assert.match(source, /cloneNode\(false\)/);
  assert.match(source, /button\[aria-label='Advertise'\][\s\S]*?button\[aria-label='Tools'\]/);
  assert.match(source, /anchorItem\.after\(separator, slot\)/);
  assert.match(source, /launcher\.classList\.add\("is-selected"\)/);
  assert.match(source, /walf-native-selection-suppressed/);
  assert.match(source, /wa-web-main-screen/);
  assert.doesNotMatch(source, /launcher\.hidden = true/);
  assert.match(source, /document\.addEventListener\("click", closePanelOnNativeNavigation, true\)/);
  assert.match(source, /button\.getBoundingClientRect\(\)\.right <= side\.getBoundingClientRect\(\)\.left/);
  assert.match(styles, /#walf-rail-slot \.walf-launcher/);
  assert.match(styles, /--walf-bg: #161717/);
  assert.match(styles, /font-family: inherit/);
  assert.doesNotMatch(styles, /font-family: Georgia/);
});

test("keeps assigned row controls compact until explicitly expanded", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const styles = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
  assert.match(source, /walf-row-group-expand/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /walf-row-group-choices/);
  assert.match(source, /actions\.append\(choices\);\s+if \(expand\) actions\.append\(expand\)/);
  assert.match(source, /d="m6 4 4 4-4 4"/);
  assert.match(source, /d="m4 6 4 4 4-4"/);
  assert.match(styles, /max-width: 0/);
  assert.doesNotMatch(styles, /cell-frame-container'\]:hover \.walf-row-group-choice/);
});

test("ships correctly sized Chrome extension icons", () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
  [16, 32, 48, 128].forEach((size) => {
    const png = readFileSync(join(__dirname, "..", manifest.icons[size]));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  });
});

test("keeps the popup version aligned with the manifest", () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
  const popup = readFileSync(join(__dirname, "..", "popup.html"), "utf8");
  assert.match(popup, new RegExp(`version-badge">v${manifest.version.replace(/\./g, "\\.")}<`));
});

test("plans grouped native rows and leaves other chats in order", () => {
  const wholesale = { name: "A", folderId: "wholesale" };
  const retail = { name: "B", folderId: "retail" };
  const other = { name: "C", folderId: null };
  const plan = planInlineFolders(
    [other, retail, wholesale],
    [{ id: "wholesale" }, { id: "retail" }]
  );

  assert.deepEqual(plan.groups.map(({ rows }) => rows[0].name), ["A", "B"]);
  assert.deepEqual(plan.ungrouped, [other]);
});

test("supports folder hide, delete, and reorder management", () => {
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const styles = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
  const popup = readFileSync(join(__dirname, "..", "popup.js"), "utf8");

  assert.match(source, /function toggleFolderHidden/);
  assert.match(source, /function moveFolder/);
  assert.match(source, /function deleteFolder/);
  assert.match(source, /const visibleFolders = \(\) => state\.folders\.filter/);
  assert.match(source, /foldersForAssignment/);
  assert.match(source, /ensureSystemFolders/);
  assert.match(source, /chatBindings/);
  assert.match(source, /describeVisibleChat/);
  assert.match(source, /stableRowKey/);
  assert.match(source, /chat\.isLeadForm && !chat\.suggestion/);
  assert.match(source, /walf-color-swatch/);
  assert.match(source, /type: "color"/);
  assert.match(source, /UNKNOWN_COLOR = "#9aa3ad"/);
  assert.match(styles, /walf-color-swatch/);
  assert.match(styles, /\.walf-inline-tab i \{[^}]*background: var\(--folder-color/);
  assert.match(source, /planInlineFolders\(listableChats, visibleFolders\(\)\)/);
  assert.match(source, /hiddenFolderIds/);
  assert.match(source, /hiddenChats\.forEach/);
  assert.match(source, /listableChats/);
  assert.match(source, /classifyLead\([^,]+, foldersForAssignment\(\)/);
  assert.match(source, /suggestedFolder = foldersForAssignment\(\)\.find/);
  assert.match(source, /suggested = foldersForAssignment\(\)\.find/);
  assert.match(source, /rememberedLeadSuggestion\(/);
  assert.match(source, /walf-native-auto-assign/);
  assert.match(source, /Assign \$\{escapeHtml\(suggestedFolder\.name\)\}/);
  assert.match(source, /assignedFolder \? "Remove folder"/);
  assert.match(source, /visibleFolders\(\)\[index\]/);
  assert.match(source, /function collapseRowGroupPicker/);
  assert.match(source, /actions\.classList\.remove\("is-open"\)/);
  assert.match(source, /collapseRowGroupPicker\(actions\)/);
  assert.match(source, /function appendRowFolderChoice/);
  assert.match(source, /is-hidden-folder/);
  assert.match(source, /ROW_HIDDEN_CHIP_LIMIT/);
  assert.match(source, /walf-row-group-hidden-menu/);
  assert.match(source, /foldersForAssignment = \(\) => state\.folders/);
  assert.match(source, / · hidden/);
  assert.match(source, /still assign chats to it/);
  assert.match(source, /walf-folder-visibility/);
  assert.match(source, /walf-folder-delete/);
  assert.match(source, /walf-folder-move/);
  assert.match(source, /changes\[STORAGE_KEY\] && state/);
  assert.match(styles, /\.walf-folder\.is-hidden/);
  assert.match(styles, /\.walf-folder-reorder/);
  assert.match(styles, /is-hidden-folder/);
  assert.match(styles, /walf-row-group-hidden-menu/);
  assert.match(popup, /data-action="toggle-hidden"/);
  assert.match(popup, /data-action="delete"/);
  assert.match(popup, /desk-folder-move/);
  assert.match(popup, /still assignable/);
  assert.equal(isValidBackupState({
    folders: [{ id: "a", name: "A", color: "#111", hidden: true }],
    contacts: { "phone:1": { id: "phone:1", name: "Lead", folderId: "a" } }
  }), true);
});

test("bulk assignment uses confident suggestions without overwriting choices", () => {
  const rows = [
    { id: "a", name: "A", folderId: null, suggestion: { folderId: "retail" } },
    { id: "b", name: "B", folderId: "wholesale", suggestion: { folderId: "retail" } },
    { id: "c", name: "C", folderId: null, suggestion: null }
  ];

  assert.deepEqual(bulkAssignments(rows), [{ id: "a", name: "A", folderId: "retail" }]);
});

test("detects chats that have unread messages", () => {
  assert.equal(hasUnread("5", "5 unread messages"), true);
  assert.equal(hasUnread("99+", "99 unread messages"), true);
  assert.equal(hasUnread("", "1 unread message"), true);
  assert.equal(hasUnread("", ""), false);
});

test("validates unique trimmed folder names for create and rename", () => {
  const folders = [{ id: "retail", name: "Retailers" }];
  assert.equal(validatedFolderName("  Prospects  ", folders), "Prospects");
  assert.equal(validatedFolderName("retailers", folders), null);
  assert.equal(validatedFolderName("Retailers", folders, "retail"), "Retailers");
  assert.equal(validatedFolderName("   ", folders), null);
});

test("recognizes lead forms and scores urgency without scoring normal chats", () => {
  assert.equal(isLeadForm("Company name: Acme\nPhone number: +213"), true);
  assert.equal(scoreLead("Company name: Acme\nOrders per month: more than 100\nI am a distributor\nI need it now").level, "hot");
  assert.equal(scoreLead("Company name: Acme\nI am just exploring").level, "cold");
  assert.equal(scoreLead("Hello, are you open?"), null);
  assert.equal(scoreLead("Company name: Facebook\nكم عدد الطلبات أو الفواتير في الشهر؟: من 100 إلى 500\nما نوع نشاطك؟: موزع أو تاجر جملة\nPhone number: +213555099110").level, "hot");
});

test("keeps a full-conversation suggestion when the sidebar row has no lead text", () => {
  const folders = [{ id: "wholesale", name: "Wholesalers" }, { id: "retail", name: "Retailers" }];
  const saved = { folderId: "wholesale", reason: "High-volume or wholesale wording" };
  assert.deepEqual(rememberedLeadSuggestion(null, saved, folders), saved);
  assert.deepEqual(rememberedLeadSuggestion({ folderId: "retail", reason: "live" }, saved, folders), {
    folderId: "retail", reason: "live"
  });
  assert.equal(rememberedLeadSuggestion(null, saved, [{ id: "retail", name: "Retailers" }]), null);
  assert.equal(rememberedLeadScore(null, { points: 4, level: "hot" }).level, "hot");
  assert.equal(rememberedLeadScore({ points: 0, level: "cold" }, { points: 4, level: "hot" }).level, "hot");
  assert.equal(rememberedLeadScore({ points: 4, level: "hot" }, { points: 2, level: "warm" }).level, "hot");
});

test("accepts only structurally valid backup state", () => {
  const valid = {
    folders: [{ id: "retail", name: "Retailers", color: "#fff" }],
    contacts: { a: { id: "a", name: "A", folderId: "retail" } }
  };
  assert.equal(isValidBackupState(valid), true);
  assert.equal(isValidBackupState({ ...valid, folders: [{ name: "Broken" }] }), false);
  assert.equal(isValidBackupState({ ...valid, contacts: [] }), false);
  assert.equal(isValidBackupState({ ...valid, contacts: { a: { id: "a", name: "A", folderId: "missing" } } }), false);
});

test("reads the chat id from WhatsApp message ids", () => {
  assert.equal(chatJidFromMessageId("false_213555010101@c.us_3EB0C1A2B3C4D5E6F7"), "213555010101@c.us");
  assert.equal(chatJidFromMessageId("true_213555010101@c.us_3EB0C1A2B3C4D5E6F7"), "213555010101@c.us");
  assert.equal(chatJidFromMessageId("false_120363000000000000@g.us_3EB0AAAA_213555010101@c.us"), "120363000000000000@g.us");
  assert.equal(chatJidFromMessageId("false_98765432101234@lid_3EB0AAAA"), "98765432101234@lid");
  assert.equal(chatJidFromMessageId("conversation-panel"), null);
  assert.equal(jidPhone("213555010101@c.us"), "+213555010101");
  assert.equal(jidPhone("98765432101234@lid"), null);
  assert.equal(jidPhone("120363000000000000@g.us"), null);
});

test("matches folders to WhatsApp lists by name or plural only", () => {
  const lists = ["New order", "Lead", "VIP", "VVIP", "Cash Van", "Fabricant"];
  assert.equal(guessNativeList("Cash Vans", lists), "Cash Van");
  assert.equal(guessNativeList("vip", lists), "VIP");
  assert.equal(guessNativeList("Leads", lists), "Lead");
  assert.equal(guessNativeList("Producers", lists), null);
  assert.equal(sameNativeList("VIP", "VVIP"), false);
  assert.equal(sameNativeList(null, null), false);
});

test("drives WhatsApp lists through visible UI and keeps a structure report", () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
  const lists = readFileSync(join(__dirname, "..", "native-lists.js"), "utf8");
  const source = readFileSync(join(__dirname, "..", "content.js"), "utf8");
  const popup = readFileSync(join(__dirname, "..", "popup.js"), "utf8");
  assert.deepEqual(manifest.content_scripts[0].js, ["classifier.js", "native-lists.js", "content.js"]);
  assert.match(lists, /function setActiveChatLists/);
  assert.match(lists, /Toggling blind could remove a label/);
  assert.match(lists, /async function probe/);
  assert.match(source, /const nativeMode = Boolean/);
  assert.match(source, /function importNativeMembers/);
  assert.match(source, /function syncActiveChatNativeList/);
  assert.match(source, /Not in the WhatsApp list yet/);
  assert.match(source, /state\.chatBindings\[`jid:\$\{chat\.jid\}`\]/);
  assert.match(popup, /\.\.\.folder,\s+id: folder\.id/);
  assert.match(source, /async function syncFolderToNativeList\(folder\)/);
  assert.match(source, /openSavedContact\(contact, \{ reload: false \}\)/);
  assert.match(source, /if \(!batchSync\) void syncActiveChatNativeList\(\)/);
});
