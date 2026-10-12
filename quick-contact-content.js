/* global WA_DZ_PHONE_SOURCE, waNormalizeAlgerian, waNormalizeNumber, waFormatDisplay, waIsDetectionAllowedOnHost, waIsHardBlockedHost */

(function () {
  'use strict';

  if (window.__waQcLoaded) return;
  window.__waQcLoaded = true;

  // Never run detection UI on WhatsApp itself (also enforced in settings helper)
  const PAGE_HOST = (location.hostname || '').toLowerCase();
  if (typeof waIsHardBlockedHost === 'function' && waIsHardBlockedHost(PAGE_HOST)) {
    // Still allow toasts from background on non-WA pages only; exit fully on WA hosts
    window.__waQcLoaded = true;
    return;
  }

  const SKIP_SELECTOR =
    'script,style,noscript,textarea,input,select,option,code,pre,svg,canvas,iframe,[contenteditable="true"],.wa-qc-phone,#wa-qc-bubble-root,#wa-qc-toast-host,#wa-country-picker-overlay';

  const PHONE_REGEX = new RegExp(WA_DZ_PHONE_SOURCE, 'g');

  let settings = {
    preferredTarget: 'app',
    defaultCountryCode: '+213',
    cooldownMinutes: 15,
    detectionEnabled: true,
    domainMode: 'all',
    scopedDomains: [],
    blockedDomains: []
  };

  let scanTimer = null;
  let activePhoneEl = null;
  let bubbleRoot = null;

  const WA_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

  const COPY_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

  // â€”â€”â€” Settings â€”â€”â€”
  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'WA_GET_SETTINGS' }, (res) => {
          if (chrome.runtime.lastError || !res) {
            resolve(settings);
            return;
          }
          settings = { ...settings, ...res };
          resolve(settings);
        });
      } catch (_) {
        resolve(settings);
      }
    });
  }

  function isDetectionActiveHere() {
    if (typeof waIsDetectionAllowedOnHost === 'function') {
      return waIsDetectionAllowedOnHost(PAGE_HOST, settings);
    }
    return settings.detectionEnabled !== false;
  }

  function stripAllHighlights() {
    closeBubble();
    document.querySelectorAll('.wa-qc-phone').forEach((el) => {
      try {
        // Keep tel: links as links; only unwrap spans we created
        if (el.tagName === 'A') {
          el.classList.remove('wa-qc-phone');
          el.removeAttribute('data-wa-raw');
          el.removeAttribute('data-wa-digits');
          el.removeAttribute('title');
          el.__waQcBound = false;
          return;
        }
        const text = document.createTextNode(el.textContent);
        el.replaceWith(text);
      } catch (_) {
        /* ignore */
      }
    });
  }

  function applyDetectionState() {
    if (!isDetectionActiveHere()) {
      stripAllHighlights();
      return false;
    }
    scheduleScan(document);
    return true;
  }

  // â€”â€”â€” Toast (#8) â€”â€”â€”
  function ensureToastHost() {
    let host = document.getElementById('wa-qc-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'wa-qc-toast-host';
      document.documentElement.appendChild(host);
    }
    return host;
  }

  function showToast({ kind = 'info', message, digits, action, target, onAction, actionLabel }) {
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = `wa-qc-toast wa-qc-toast-${kind === 'success' ? 'success' : kind === 'warn' ? 'warn' : 'info'}`;

    let text = message;
    if (!text && kind === 'success' && digits) {
      const where = target === 'web' ? 'WhatsApp Web' : 'the app';
      const verb = action === 'call' ? 'Calling' : 'Opening chat with';
      text = `${verb} <strong>+${digits}</strong> via ${where}`;
    }
    if (!text) text = 'Done';

    el.innerHTML = `
      <div class="wa-qc-toast-msg">${text}</div>
      ${onAction && actionLabel ? `<button type="button" class="wa-qc-toast-action">${actionLabel}</button>` : ''}
      <button type="button" class="wa-qc-toast-close" aria-label="Dismiss">Ã—</button>
    `;

    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('wa-qc-toast-show'));

    const remove = () => {
      el.classList.remove('wa-qc-toast-show');
      setTimeout(() => el.remove(), 300);
    };

    el.querySelector('.wa-qc-toast-close').addEventListener('click', remove);
    const actionBtn = el.querySelector('.wa-qc-toast-action');
    if (actionBtn && onAction) {
      actionBtn.addEventListener('click', () => {
        onAction();
        remove();
      });
    }

    if (!onAction) {
      setTimeout(remove, kind === 'warn' ? 8000 : 3200);
    }

    return el;
  }

  // â€”â€”â€” Open via background â€”â€”â€”
  function openWhatsApp({ raw, action, target, force }) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'WA_OPEN', raw, action, target, force: !!force },
        (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false });
        }
      );
    });
  }

  // â€”â€”â€” Bubble UI â€”â€”â€”
  function ensureBubbleRoot() {
    if (bubbleRoot && document.documentElement.contains(bubbleRoot)) return bubbleRoot;
    bubbleRoot = document.createElement('div');
    bubbleRoot.id = 'wa-qc-bubble-root';
    document.documentElement.appendChild(bubbleRoot);
    return bubbleRoot;
  }

  function closeBubble() {
    if (activePhoneEl) activePhoneEl.classList.remove('wa-qc-active');
    activePhoneEl = null;
    const root = document.getElementById('wa-qc-bubble-root');
    if (root) root.innerHTML = '';
  }

  function placeBubble(anchorEl, raw, digits) {
    try {
      closeBubble();
      activePhoneEl = anchorEl;
      if (anchorEl && anchorEl.classList) {
        anchorEl.classList.add('wa-qc-active');
      }

      const root = ensureBubbleRoot();
      const rect = anchorEl.getBoundingClientRect();
      const preferred = settings.preferredTarget || 'app';
      const display =
        typeof waFormatDisplay === 'function' && digits
          ? waFormatDisplay(digits)
          : digits
            ? '+' + digits
            : String(raw || '');

      const bubble = document.createElement('div');
      bubble.className = 'wa-qc-bubble';
      bubble.setAttribute('role', 'dialog');
      bubble.setAttribute('aria-label', 'WhatsApp actions');

      // position: fixed â€” coords are viewport-relative (same as getBoundingClientRect)
      const cx = rect.left + rect.width / 2;
      const openAbove = rect.top > 120;
      if (openAbove) {
        bubble.style.left = `${cx}px`;
        bubble.style.top = `${rect.top - 8}px`;
        bubble.style.transform = 'translate(-50%, -100%)';
      } else {
        bubble.style.left = `${cx}px`;
        bubble.style.top = `${rect.bottom + 8}px`;
        bubble.style.transform = 'translate(-50%, 0)';
        bubble.classList.add('wa-qc-bubble-below');
      }

      const stack = document.createElement('div');
      stack.className = 'wa-qc-bubble-stack';

      const label = document.createElement('div');
      label.className = 'wa-qc-bubble-label';
      label.textContent = display;

      function addBtn({ text, cls, icon, onClick }) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `wa-qc-bubble-btn ${cls}`;
        btn.innerHTML = `${icon || ''}<span>${text}</span>`;
        // pointerdown is more reliable than click on aggressive SPAs
        const fire = (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          onClick();
        };
        btn.addEventListener('pointerdown', fire, true);
        btn.addEventListener('click', fire, true);
        stack.appendChild(btn);
        return btn;
      }

      async function doOpen(action, target, force) {
        closeBubble();
        const res = await openWhatsApp({
          raw: raw,
          action,
          target: target || (preferred === 'ask' ? 'app' : preferred),
          force
        });
        if (res && res.ok === false && res.error === 'unresolved') {
          showToast({
            kind: 'info',
            message: 'Could not resolve this number. Try selecting it and using the context menu.'
          });
        }
      }

      async function doCopy() {
        // Prefer E.164 (+digits) for paste into WhatsApp / contacts
        const text = digits ? '+' + digits : String(raw || '').trim();
        let ok = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            ok = true;
          }
        } catch (_) {
          ok = false;
        }
        if (!ok) {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            ok = document.execCommand('copy');
            ta.remove();
          } catch (_) {
            ok = false;
          }
        }
        closeBubble();
        showToast({
          kind: ok ? 'success' : 'info',
          message: ok
            ? `Copied <strong>${display || text}</strong>`
            : 'Could not copy â€” select the number and copy manually'
        });
      }

      const askEveryTime = preferred === 'ask' || !preferred;

      if (!askEveryTime) {
        addBtn({
          text: 'Message',
          cls: 'wa-qc-bubble-btn-primary',
          icon: WA_ICON,
          onClick: () => doOpen('message', preferred)
        });
        addBtn({
          text: 'Call',
          cls: 'wa-qc-bubble-btn-secondary',
          onClick: () => doOpen('call', preferred)
        });
        addBtn({
          text: 'Copy',
          cls: 'wa-qc-bubble-btn-copy',
          icon: COPY_ICON,
          onClick: () => doCopy()
        });
      } else {
        addBtn({
          text: 'Message Â· App',
          cls: 'wa-qc-bubble-btn-primary',
          icon: WA_ICON,
          onClick: () => doOpen('message', 'app')
        });
        addBtn({
          text: 'Message Â· Web',
          cls: 'wa-qc-bubble-btn-secondary',
          onClick: () => doOpen('message', 'web')
        });
        addBtn({
          text: 'Call Â· App',
          cls: 'wa-qc-bubble-btn-ghost',
          onClick: () => doOpen('call', 'app')
        });
        addBtn({
          text: 'Call Â· Web',
          cls: 'wa-qc-bubble-btn-ghost',
          onClick: () => doOpen('call', 'web')
        });
        addBtn({
          text: 'Copy',
          cls: 'wa-qc-bubble-btn-copy',
          icon: COPY_ICON,
          onClick: () => doCopy()
        });
      }

      const caret = document.createElement('div');
      caret.className = 'wa-qc-bubble-caret';

      if (openAbove) {
        bubble.appendChild(label);
        bubble.appendChild(stack);
        bubble.appendChild(caret);
      } else {
        bubble.appendChild(caret);
        bubble.appendChild(stack);
        bubble.appendChild(label);
      }

      root.appendChild(bubble);

      // Force paint then animate in (double rAF for layout)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          bubble.classList.add('wa-qc-open');
          // Inline fallback if page CSS fights our stylesheet
          bubble.querySelectorAll('.wa-qc-bubble-btn').forEach((b) => {
            b.style.opacity = '1';
            b.style.transform = 'translateY(0) scale(1)';
          });
          bubble.querySelectorAll('.wa-qc-bubble-label, .wa-qc-bubble-caret').forEach((b) => {
            b.style.opacity = '1';
          });
        });
      });
    } catch (err) {
      console.warn('[WA Quick Contact] placeBubble failed', err);
      showToast({
        kind: 'info',
        message: 'Could not open action menu. Try right-click â†’ WhatsApp instead.'
      });
    }
  }

  function eventElement(target) {
    if (!target) return null;
    if (target.nodeType === Node.ELEMENT_NODE) return target;
    return target.parentElement || null;
  }

  function findPhoneEl(from) {
    const el = eventElement(from);
    if (!el || !el.closest) return null;
    return el.closest('.wa-qc-phone');
  }

  function onPhoneActivate(phone, e) {
    if (!phone) return;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
    const raw = phone.getAttribute('data-wa-raw') || phone.dataset.waRaw || phone.textContent;
    const digits =
      phone.getAttribute('data-wa-digits') ||
      phone.dataset.waDigits ||
      resolveDigitsFromMatch(raw);
    placeBubble(phone, raw, digits);
  }

  /** Direct binding â€” survives flaky document-level delegation on some sites */
  function bindPhoneEl(span) {
    if (!span || span.__waQcBound) return;
    span.__waQcBound = true;
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    const handler = (e) => onPhoneActivate(span, e);
    span.addEventListener('click', handler, true);
    span.addEventListener('pointerdown', (e) => {
      // Only primary button; let focus/selection still work lightly
      if (e.button !== 0) return;
      // Prefer click for accessibility; pointerdown helps when click is cancelled
      // Delay to allow click to fire first on normal pages
    });
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        onPhoneActivate(span, e);
      }
    });
  }

  function showCooldownToast(payload) {
    const mins = payload.minutesAgo ?? 0;
    const digits = payload.digits || '';
    showToast({
      kind: 'warn',
      message: `Already opened <strong>+${digits}</strong> ${mins === 0 ? 'just now' : mins + ' min ago'}. Open again?`,
      actionLabel: 'Open anyway',
      onAction: () => {
        openWhatsApp({
          raw: digits,
          action: payload.action || 'message',
          target: payload.target,
          force: true
        });
      }
    });
  }

  // â€”â€”â€” Highlighting â€”â€”â€”
  function isSkippable(node) {
    const el = node.parentElement;
    if (!el) return true;
    if (el.closest(SKIP_SELECTOR)) return true;
    if (el.closest('a[href^="mailto:"]')) return true;
    return false;
  }

  function resolveDigitsFromMatch(text) {
    return (
      waNormalizeAlgerian(text) ||
      waNormalizeNumber(text, settings.defaultCountryCode) ||
      null
    );
  }

  function wrapMatchesInTextNode(textNode) {
    const text = textNode.nodeValue;
    if (!text || !/\d/.test(text)) return;

    PHONE_REGEX.lastIndex = 0;
    if (!PHONE_REGEX.test(text)) return;
    PHONE_REGEX.lastIndex = 0;

    if (isSkippable(textNode)) return;
    // Already wrapped parent
    if (textNode.parentElement && textNode.parentElement.classList.contains('wa-qc-phone')) {
      return;
    }

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    PHONE_REGEX.lastIndex = 0;

    while ((match = PHONE_REGEX.exec(text)) !== null) {
      const raw = match[0];
      const digits = resolveDigitsFromMatch(raw);
      // Require confident parse (avoid highlighting random digit runs)
      if (!digits) {
        continue;
      }

      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const span = document.createElement('span');
      span.className = 'wa-qc-phone';
      span.setAttribute('data-wa-raw', raw);
      span.setAttribute('data-wa-digits', digits);
      span.dataset.waRaw = raw;
      span.dataset.waDigits = digits;
      span.title = `WhatsApp: ${typeof waFormatDisplay === 'function' ? waFormatDisplay(digits) : '+' + digits}`;
      span.textContent = raw;
      bindPhoneEl(span);
      frag.appendChild(span);

      lastIndex = match.index + raw.length;
    }

    if (lastIndex === 0) return; // nothing wrapped
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(frag, textNode);
  }

  function scanRoot(root) {
    if (!isDetectionActiveHere()) return;
    const base =
      !root || root === document || root.nodeType === Node.DOCUMENT_NODE
        ? document.body
        : root;
    if (!base) return;

    const walker = document.createTreeWalker(
      base,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !/[050607213]/.test(node.nodeValue)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (isSkippable(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    // Cap work per scan for huge pages
    const limit = 800;
    for (let i = 0; i < nodes.length && i < limit; i++) {
      try {
        wrapMatchesInTextNode(nodes[i]);
      } catch (_) {
        /* ignore DOM races */
      }
    }

    enhanceTelLinks(base);
  }

  function enhanceTelLinks(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      if (a.classList.contains('wa-qc-phone')) return;
      const href = a.getAttribute('href') || '';
      const raw = decodeURIComponent(href.replace(/^tel:/i, '')).trim();
      const digits = resolveDigitsFromMatch(raw);
      if (!digits) return;
      a.classList.add('wa-qc-phone');
      a.setAttribute('data-wa-raw', raw);
      a.setAttribute('data-wa-digits', digits);
      a.dataset.waRaw = raw;
      a.dataset.waDigits = digits;
      a.title = `WhatsApp: ${typeof waFormatDisplay === 'function' ? waFormatDisplay(digits) : '+' + digits}`;
      bindPhoneEl(a);
    });
  }

  function scheduleScan(root) {
    if (!isDetectionActiveHere()) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      try {
        scanRoot(root || document);
        rebindAllPhones();
      } catch (_) {
        /* ignore */
      }
    }, 250);
  }

  // â€”â€”â€” Events (delegation backup + outside dismiss) â€”â€”â€”
  document.addEventListener(
    'click',
    (e) => {
      const phone = findPhoneEl(e.target);
      if (phone) {
        onPhoneActivate(phone, e);
        return;
      }

      const el = eventElement(e.target);
      if (!el || !el.closest || !el.closest('#wa-qc-bubble-root')) {
        // Don't close on the same tick we opened (bubble buttons use stopPropagation)
        if (activePhoneEl) closeBubble();
      }
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBubble();
  });

  // Only dismiss on real scroll of page, not scroll inside bubble
  window.addEventListener(
    'scroll',
    (e) => {
      if (!activePhoneEl) return;
      if (e.target && e.target.closest && e.target.closest('#wa-qc-bubble-root')) return;
      closeBubble();
    },
    true
  );

  // Re-bind any phones that lost listeners after SPA re-render of attributes only
  function rebindAllPhones() {
    document.querySelectorAll('.wa-qc-phone').forEach(bindPhoneEl);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;

    if (message.type === 'WA_TOAST') {
      const p = message.payload || {};
      if (p.message) {
        showToast({ kind: p.kind || 'info', message: p.message });
      } else {
        showToast({
          kind: p.kind || 'success',
          digits: p.digits,
          action: p.action,
          target: p.target
        });
      }
    }

    if (message.type === 'WA_COOLDOWN') {
      showCooldownToast(message.payload || {});
    }
  });

  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== 'local') return;
    if (changes.preferredTarget) {
      settings.preferredTarget = changes.preferredTarget.newValue || 'app';
    }
    if (changes.defaultCountryCode) {
      settings.defaultCountryCode = changes.defaultCountryCode.newValue || '+213';
    }
    if (changes.cooldownMinutes) {
      settings.cooldownMinutes = changes.cooldownMinutes.newValue;
    }
    if (changes.detectionEnabled) {
      settings.detectionEnabled = changes.detectionEnabled.newValue !== false;
    }
    if (changes.domainMode) {
      settings.domainMode = changes.domainMode.newValue === 'allowlist' ? 'allowlist' : 'all';
    }
    if (changes.scopedDomains) {
      settings.scopedDomains = Array.isArray(changes.scopedDomains.newValue)
        ? changes.scopedDomains.newValue
        : [];
    }
    if (changes.blockedDomains) {
      settings.blockedDomains = Array.isArray(changes.blockedDomains.newValue)
        ? changes.blockedDomains.newValue
        : [];
    }

    if (
      changes.detectionEnabled ||
      changes.domainMode ||
      changes.scopedDomains ||
      changes.blockedDomains
    ) {
      applyDetectionState();
    }
  });

  // MutationObserver for dynamic pages
  const observer = new MutationObserver((mutations) => {
    if (!isDetectionActiveHere()) return;
    let needs = false;
    for (const m of mutations) {
      if (m.type === 'childList' && m.addedNodes.length) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.id === 'wa-qc-bubble-root' || node.id === 'wa-qc-toast-host') continue;
            if (node.classList && node.classList.contains('wa-qc-phone')) continue;
            needs = true;
            break;
          }
          if (node.nodeType === Node.TEXT_NODE && node.nodeValue && /\d/.test(node.nodeValue)) {
            needs = true;
            break;
          }
        }
      }
      if (needs) break;
    }
    if (needs) scheduleScan(document);
  });

  // Boot
  loadSettings().then(() => {
    const start = () => {
      if (!document.body) return;
      observer.observe(document.body, { childList: true, subtree: true });
      applyDetectionState();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  });
})();

