// Drives WhatsApp's own lists (Business labels) through its visible UI: the filter chips
// above the chat list and the list menu in the open chat's header. WhatsApp does not
// expose stable selectors for these, so everything is found by role and visible text.
// If WhatsApp's markup changes, `probe()` produces an anonymised structure report.
(function (root) {
  const BUILT_IN = new Set(["all", "unread", "favourites", "favorites", "groups", "contacts", "non contacts",
    "communities", "drafts"]);
  const MENU_MARKERS = /^(manage lists|new list|manage labels|new label|add new label)$/;
  const CLICKABLE = "button, [role='button'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='checkbox'], [role='option'], li, label";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const listKey = (value) => norm(value).replace(/(?:es|s)$/u, "");
  const sameName = (a, b) => Boolean(a && b) && listKey(a) === listKey(b);
  const textOf = (element) => String(element?.innerText ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
  const isOurs = (element) => Boolean(element?.closest?.("#wa-lead-folders, [class*='walf-']"));
  const isVisible = (element) => Boolean(element?.isConnected && element.getClientRects().length);

  async function waitFor(find, timeout = 1500) {
    const started = Date.now();
    for (;;) {
      const found = find();
      if (found) return found;
      if (Date.now() - started > timeout) return null;
      await sleep(50);
    }
  }

  // Some WhatsApp controls react to pointer events rather than a bare click().
  function press(element) {
    const options = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new PointerEvent("pointerdown", options));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new PointerEvent("pointerup", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.click();
  }

  function pressEscape() {
    const target = document.activeElement || document.body;
    ["keydown", "keyup"].forEach((type) => target.dispatchEvent(new KeyboardEvent(type, {
      key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true
    })));
  }

  // Deepest visible elements (outside our UI) whose own text equals one of `names`.
  function elementsWithText(scope, matches) {
    if (!scope) return [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const found = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || found.has(element) || isOurs(element) || !matches(norm(node.textContent))) continue;
      if (isVisible(element)) found.add(element);
    }
    return [...found];
  }

  // ---- Filter chips above the chat list -------------------------------------------------

  function chipBar() {
    const side = document.querySelector("#side");
    if (!side) return null;
    const outsideList = (element) => !element.closest("#pane-side") && !isOurs(element) && isVisible(element);
    const tablist = [...side.querySelectorAll("[role='tablist']")].find(outsideList);
    if (tablist) return tablist;
    const all = [...side.querySelectorAll("button, [role='button'], [role='tab']")]
      .find((element) => outsideList(element) && norm(textOf(element)) === "all");
    let container = all?.parentElement;
    while (container && container !== side) {
      if (container.querySelectorAll("button, [role='button'], [role='tab']").length >= 3) return container;
      container = container.parentElement;
    }
    return null;
  }

  function chips() {
    const bar = chipBar();
    if (!bar) return [];
    const controls = [...bar.querySelectorAll("button, [role='button'], [role='tab']")]
      .filter((element) => isVisible(element) && !element.parentElement?.closest("button, [role='button'], [role='tab']"));
    return controls.map((element) => {
      const name = textOf(element);
      const active = [element, ...element.querySelectorAll("[aria-selected], [aria-pressed], [aria-checked]")]
        .some((node) => ["aria-selected", "aria-pressed", "aria-checked"]
          .some((attribute) => node.getAttribute?.(attribute) === "true"));
      return { name, element, active, builtIn: BUILT_IN.has(norm(name)), overflow: !name };
    });
  }

  function listNames() {
    return chips().filter((chip) => chip.name && !chip.builtIn).map((chip) => chip.name);
  }

  function activeListName() {
    const active = chips().find((chip) => chip.active && chip.name);
    return active && !active.builtIn ? active.name : null;
  }

  async function activate(name) {
    const chip = chips().find((item) => item.name && sameName(item.name, name));
    if (chip) {
      if (!chip.active) press(chip.element);
      return true;
    }
    // Lists that don't fit in the bar sit behind its overflow (chevron) button.
    const overflow = chips().filter((item) => item.overflow).pop();
    if (!overflow) return false;
    press(overflow.element);
    const bar = chipBar();
    const item = await waitFor(() => elementsWithText(document.body, (text) => sameName(text, name))
      .find((element) => !bar?.contains(element) && !element.closest("#pane-side, #main")));
    if (!item) {
      pressEscape();
      return false;
    }
    press(item.closest(CLICKABLE) || item);
    return true;
  }

  async function activateAll() {
    const all = chips().find((chip) => norm(chip.name) === "all");
    if (!all) return false;
    if (!all.active) press(all.element);
    return true;
  }

  // ---- List menu for the open chat ------------------------------------------------------

  function headerButtons() {
    const header = document.querySelector("#main header");
    if (!header) return [];
    return [...header.querySelectorAll("button, [role='button']")]
      .filter((element) => isVisible(element) && !isOurs(element));
  }

  function headerListTrigger(knownNames = []) {
    const buttons = headerButtons();
    const label = (element) => `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`;
    return buttons.find((element) => /\b(lists?|labels?)\b/i.test(label(element)))
      || buttons.find((element) => knownNames.some((name) => sameName(textOf(element), name)))
      || buttons.find((element) => /^(add to list|add label|lists?|labels?)$/i.test(textOf(element)))
      || null;
  }

  function openMenuRoot() {
    const marker = elementsWithText(document.body, (text) => MENU_MARKERS.test(text))
      .find((element) => !element.closest("#pane-side"));
    if (!marker) return null;
    let node = marker;
    for (let depth = 0; depth < 10 && node.parentElement && node.parentElement !== document.body; depth += 1) {
      node = node.parentElement;
      if (node.querySelectorAll("[aria-checked], [role='checkbox'], input[type='checkbox']").length >= 2
        || node.querySelectorAll("li, [role='menuitem'], [role='menuitemcheckbox'], [role='option']").length >= 3) return node;
    }
    return marker.closest("[role='menu'], [role='dialog'], [role='application'], ul") || marker.parentElement;
  }

  function menuListNames(menu) {
    if (!menu) return [];
    const items = [...menu.querySelectorAll("li, [role='menuitem'], [role='menuitemcheckbox'], [role='option'], [role='checkbox']")];
    return [...new Set(items.map(textOf).filter((text) => text && text.length <= 60 && !MENU_MARKERS.test(norm(text))))];
  }

  function menuItem(menu, name) {
    const label = elementsWithText(menu, (text) => sameName(text, name))[0];
    if (!label) return null;
    const row = label.closest("li, [role='menuitem'], [role='menuitemcheckbox'], [role='option'], [role='checkbox']");
    return { label, row: row && menu.contains(row) ? row : label.parentElement };
  }

  function checkedState(item) {
    const scope = item.row;
    const candidates = [scope, ...scope.querySelectorAll("[aria-checked], [role='checkbox'], input[type='checkbox'], [data-icon]")];
    for (const node of candidates) {
      if (node instanceof HTMLInputElement && node.type === "checkbox") return node.checked;
      const aria = node.getAttribute?.("aria-checked");
      if (aria === "true") return true;
      if (aria === "false") return false;
      const icon = node.getAttribute?.("data-icon") || "";
      if (/unchecked|checkbox-?empty|check-?off/i.test(icon)) return false;
      if (/checked|check-?on/i.test(icon)) return true;
    }
    const selected = scope.getAttribute("aria-selected");
    return selected === "true" ? true : selected === "false" ? false : null;
  }

  async function openListMenu(knownNames) {
    const existing = openMenuRoot();
    if (existing) return existing;
    const trigger = headerListTrigger(knownNames);
    if (trigger) {
      press(trigger);
      const menu = await waitFor(openMenuRoot);
      if (menu) return menu;
      pressEscape();
    }
    // Fallback: the chat's ⋮ menu usually carries an "Add to list" / "Label chat" entry.
    const more = headerButtons().find((element) => /^(menu|more options)$/i.test(element.getAttribute("aria-label")
      || element.getAttribute("title") || ""));
    if (!more) return null;
    press(more);
    const entry = await waitFor(() => elementsWithText(document.body,
      (text) => /^(add to list|label chat|lists?|labels?)$/.test(text)).find((element) => !element.closest("#pane-side")));
    if (!entry) {
      pressEscape();
      return null;
    }
    press(entry.closest(CLICKABLE) || entry);
    return waitFor(openMenuRoot);
  }

  function closeListMenu(menu) {
    const done = menu && [...menu.querySelectorAll("button, [role='button']")]
      .find((element) => /^(save|done|apply|ok)$/i.test(textOf(element)));
    if (done) press(done);
    else pressEscape();
  }

  // Ensure the open chat is in every `add` list and out of every `remove` list.
  async function setActiveChatLists({ add = [], remove = [], knownNames = [] } = {}) {
    const menu = await openListMenu([...knownNames, ...add, ...remove]);
    if (!menu) return { ok: false, reason: "list menu not found", names: [] };
    const names = menuListNames(menu);
    const result = { ok: true, names, changed: [], missing: [], unknown: [] };
    const wanted = [...add.map((name) => [name, true]), ...remove.map((name) => [name, false])];
    for (const [name, shouldBeChecked] of wanted) {
      const current = openMenuRoot() || menu;
      const item = menuItem(current, name);
      if (!item) {
        result.missing.push(name);
        continue;
      }
      const checked = checkedState(item);
      if (checked === shouldBeChecked) continue;
      if (checked === null) {
        // Toggling blind could remove a label the chat already had.
        result.unknown.push(name);
        continue;
      }
      press(item.row.closest(CLICKABLE) || item.row);
      const verified = await waitFor(() => {
        const after = menuItem(openMenuRoot() || current, name);
        return after && checkedState(after) === shouldBeChecked ? after : null;
      }, 1200);
      if (verified) result.changed.push(name);
      else result.unknown.push(name);
    }
    closeListMenu(openMenuRoot() || menu);
    if (result.missing.length || result.unknown.length) {
      result.ok = false;
      result.reason = result.missing.length
        ? `no list named ${result.missing.join(", ")}`
        : `couldn't confirm ${result.unknown.join(", ")}`;
    }
    return result;
  }

  // ---- Structure report -----------------------------------------------------------------

  const mask = (value) => String(value || "").replace(/\d/g, "#").slice(0, 80);

  function outline(element, { depth = 0, maxDepth = 9, budget = { left: 500 }, withText = false } = {}) {
    if (!element || budget.left-- <= 0 || isOurs(element)) return null;
    const node = { tag: element.tagName.toLowerCase() };
    for (const attribute of ["id", "role", "aria-label", "aria-selected", "aria-pressed", "aria-checked",
      "aria-haspopup", "aria-expanded", "data-testid", "data-icon", "title", "tabindex"]) {
      const value = element.getAttribute(attribute);
      if (value !== null) node[attribute] = mask(value);
    }
    const children = [...element.children];
    if (withText && !children.length && textOf(element)) node.text = mask(textOf(element));
    if (depth < maxDepth && children.length) {
      node.children = children.map((child) => outline(child, { depth: depth + 1, maxDepth, budget, withText })).filter(Boolean);
    } else if (children.length) node.childCount = children.length;
    return node;
  }

  async function probe({ openMenu = false, knownNames = [] } = {}) {
    const bar = chipBar();
    const messageIds = [...document.querySelectorAll("#main [data-id]")].slice(-3)
      .map((element) => mask(String(element.getAttribute("data-id")).replace(/_[A-Za-z0-9]{8,}(?=_|$)/g, "_<msg>")));
    const report = {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      chipBarFound: Boolean(bar),
      chips: chips().map(({ name, active, builtIn, overflow }) => ({ name: mask(name), active, builtIn, overflow })),
      activeList: activeListName(),
      headerTrigger: (() => {
        const trigger = headerListTrigger(knownNames);
        return trigger ? outline(trigger, { maxDepth: 3, withText: true }) : null;
      })(),
      messageIdShapes: messageIds,
      chipBar: outline(bar, { withText: true }),
      header: outline(document.querySelector("#main header"), { maxDepth: 7 })
    };
    if (openMenu) {
      const menu = await openListMenu(knownNames);
      report.menuFound = Boolean(menu);
      report.menu = outline(menu, { withText: true });
      report.menuNames = menuListNames(menu).map(mask);
      if (menu) closeListMenu(menu);
    }
    return report;
  }

  root.WALeadNativeLists = {
    listNames, activeListName, activate, activateAll, setActiveChatLists, probe, sameName
  };
})(globalThis);
