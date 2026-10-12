const COMMON_COUNTRY_CODES = [
  { code: '+1', country: 'US/CA', flag: '' },
  { code: '+44', country: 'UK', flag: '' },
  { code: '+49', country: 'Germany', flag: '' },
  { code: '+33', country: 'France', flag: '' },
  { code: '+34', country: 'Spain', flag: '' },
  { code: '+39', country: 'Italy', flag: '' },
  { code: '+31', country: 'Netherlands', flag: '' },
  { code: '+32', country: 'Belgium', flag: '' },
  { code: '+41', country: 'Switzerland', flag: '' },
  { code: '+43', country: 'Austria', flag: '' },
  { code: '+46', country: 'Sweden', flag: '' },
  { code: '+47', country: 'Norway', flag: '' },
  { code: '+45', country: 'Denmark', flag: '' },
  { code: '+358', country: 'Finland', flag: '' },
  { code: '+48', country: 'Poland', flag: '' },
  { code: '+420', country: 'Czechia', flag: '' },
  { code: '+36', country: 'Hungary', flag: '' },
  { code: '+30', country: 'Greece', flag: '' },
  { code: '+351', country: 'Portugal', flag: '' },
  { code: '+353', country: 'Ireland', flag: '' },
  { code: '+61', country: 'Australia', flag: '' },
  { code: '+64', country: 'New Zealand', flag: '' },
  { code: '+81', country: 'Japan', flag: '' },
  { code: '+82', country: 'South Korea', flag: '' },
  { code: '+86', country: 'China', flag: '' },
  { code: '+91', country: 'India', flag: '' },
  { code: '+65', country: 'Singapore', flag: '' },
  { code: '+60', country: 'Malaysia', flag: '' },
  { code: '+66', country: 'Thailand', flag: '' },
  { code: '+63', country: 'Philippines', flag: '' },
  { code: '+62', country: 'Indonesia', flag: '' },
  { code: '+84', country: 'Vietnam', flag: '' },
  { code: '+971', country: 'UAE', flag: '' },
  { code: '+966', country: 'Saudi Arabia', flag: '' },
  { code: '+972', country: 'Israel', flag: '' },
  { code: '+90', country: 'Turkey', flag: '' },
  { code: '+27', country: 'South Africa', flag: '' },
  { code: '+20', country: 'Egypt', flag: '' },
  { code: '+234', country: 'Nigeria', flag: '' },
  { code: '+254', country: 'Kenya', flag: '' },
  { code: '+212', country: 'Morocco', flag: '' },
  { code: '+213', country: 'Algeria', flag: '' },
  { code: '+55', country: 'Brazil', flag: '' },
  { code: '+52', country: 'Mexico', flag: '' },
  { code: '+54', country: 'Argentina', flag: '' },
  { code: '+56', country: 'Chile', flag: '' },
  { code: '+57', country: 'Colombia', flag: '' },
  { code: '+51', country: 'Peru', flag: '' },
  { code: '+58', country: 'Venezuela', flag: '' },
  { code: '+7', country: 'Russia', flag: '' },
  { code: '+380', country: 'Ukraine', flag: '' },
  { code: '+375', country: 'Belarus', flag: '' },
  { code: '+371', country: 'Latvia', flag: '' },
  { code: '+372', country: 'Estonia', flag: '' },
  { code: '+370', country: 'Lithuania', flag: '' },
  { code: '+40', country: 'Romania', flag: '' },
  { code: '+359', country: 'Bulgaria', flag: '' },
  { code: '+385', country: 'Croatia', flag: '' },
  { code: '+386', country: 'Slovenia', flag: '' },
  { code: '+421', country: 'Slovakia', flag: '' },
  { code: '+357', country: 'Cyprus', flag: '' },
  { code: '+356', country: 'Malta', flag: '' },
  { code: '+352', country: 'Luxembourg', flag: '' },
  { code: '+377', country: 'Monaco', flag: '' },
  { code: '+968', country: 'Oman', flag: '' },
  { code: '+974', country: 'Qatar', flag: '' },
  { code: '+973', country: 'Bahrain', flag: '' },
  { code: '+965', country: 'Kuwait', flag: '' },
  { code: '+961', country: 'Lebanon', flag: '' },
  { code: '+962', country: 'Jordan', flag: '' },
  { code: '+960', country: 'Maldives', flag: '' },
  { code: '+94', country: 'Sri Lanka', flag: '' },
  { code: '+880', country: 'Bangladesh', flag: '' },
  { code: '+977', country: 'Nepal', flag: '' },
  { code: '+93', country: 'Afghanistan', flag: '' },
  { code: '+98', country: 'Iran', flag: '' },
  { code: '+964', country: 'Iraq', flag: '' },
  { code: '+963', country: 'Syria', flag: '' },
  { code: '+970', country: 'Palestine', flag: '' },
  { code: '+249', country: 'Sudan', flag: '' },
  { code: '+251', country: 'Ethiopia', flag: '' },
  { code: '+255', country: 'Tanzania', flag: '' },
  { code: '+256', country: 'Uganda', flag: '' },
  { code: '+260', country: 'Zambia', flag: '' },
  { code: '+263', country: 'Zimbabwe', flag: '' },
  { code: '+233', country: 'Ghana', flag: '' },
  { code: '+225', country: 'Ivory Coast', flag: '' },
  { code: '+221', country: 'Senegal', flag: '' },
  { code: '+226', country: 'Burkina Faso', flag: '' },
  { code: '+223', country: 'Mali', flag: '' },
  { code: '+227', country: 'Niger', flag: '' },
  { code: '+228', country: 'Togo', flag: '' },
  { code: '+229', country: 'Benin', flag: '' },
  { code: '+241', country: 'Gabon', flag: '' },
  { code: '+242', country: 'Congo', flag: '' },
  { code: '+243', country: 'DR Congo', flag: '' },
  { code: '+244', country: 'Angola', flag: '' },
  { code: '+250', country: 'Rwanda', flag: '' },
  { code: '+252', country: 'Somalia', flag: '' },
  { code: '+253', country: 'Djibouti', flag: '' },
  { code: '+257', country: 'Burundi', flag: '' },
  { code: '+258', country: 'Mozambique', flag: '' },
  { code: '+261', country: 'Madagascar', flag: '' },
  { code: '+265', country: 'Malawi', flag: '' },
  { code: '+266', country: 'Lesotho', flag: '' },
  { code: '+267', country: 'Botswana', flag: '' },
  { code: '+268', country: 'Eswatini', flag: '' }
];

let currentDefault = '+213';
let preferredTarget = 'app';
let cooldownMinutes = 15;
let detectionEnabled = true;
let domainMode = 'all';
let scopedDomains = [];

const searchInput = document.getElementById('search');
const countriesList = document.getElementById('countries-list');
const currentDefaultBox = document.getElementById('current-default-box');
const cooldownInput = document.getElementById('cooldown-minutes');
const detectionToggle = document.getElementById('detection-enabled');
const domainInput = document.getElementById('domain-input');
const domainListEl = document.getElementById('domain-list');
const allowlistPanel = document.getElementById('allowlist-panel');
const domainModeHint = document.getElementById('domain-mode-hint');

function normalizeDomainInput(raw) {
  let h = String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
  if (!h || /\s/.test(h)) return null;
  if (h === 'localhost') return h;
  if (!h.includes('.')) return null;
  // Never allow adding WhatsApp to allowlist (pointless / confusing)
  if (
    h === 'whatsapp.com' ||
    h.endsWith('.whatsapp.com') ||
    h === 'wa.me' ||
    h.endsWith('.wa.me') ||
    h === 'whatsapp.net' ||
    h.endsWith('.whatsapp.net')
  ) {
    return null;
  }
  return h;
}

function renderTargetButtons() {
  document.querySelectorAll('#target-segmented .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === preferredTarget);
  });
}

function renderDomainMode() {
  document.querySelectorAll('#domain-mode-segmented .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === domainMode);
  });
  const isAllow = domainMode === 'allowlist';
  allowlistPanel.classList.toggle('wa-hidden', !isAllow);
  domainModeHint.textContent = isAllow
    ? 'Highlight only on domains you list below. Right-click still works everywhere.'
    : 'Highlight on every site except WhatsApp (always excluded).';
}

function renderDomainList() {
  if (!scopedDomains.length) {
    domainListEl.innerHTML =
      '<div class="domain-empty">No sites yet â€” add domains to highlight numbers</div>';
    return;
  }
  domainListEl.innerHTML = scopedDomains
    .map(
      (d) => `
    <div class="domain-item" data-domain="${d}">
      <code>${d}</code>
      <button type="button" data-remove="${d}">Remove</button>
    </div>`
    )
    .join('');

  domainListEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-remove');
      scopedDomains = scopedDomains.filter((x) => x !== d);
      chrome.storage.local.set({ scopedDomains });
      renderDomainList();
    });
  });
}

function addDomain(raw) {
  const h = normalizeDomainInput(raw);
  if (!h) return false;
  if (!scopedDomains.includes(h)) {
    scopedDomains = [...scopedDomains, h].sort();
    chrome.storage.local.set({ scopedDomains });
    renderDomainList();
  }
  return true;
}

function renderCurrentDefault() {
  if (currentDefault) {
    const country = COMMON_COUNTRY_CODES.find((c) => c.code === currentDefault);
    currentDefaultBox.innerHTML = `
      <div class="current-default">
        <span class="flag">${country ? country.flag : 'ðŸŒ'}</span>
        <div class="info">
          <div class="label">Current Default</div>
          <div class="value">${currentDefault} ${country ? 'Â· ' + country.country : ''}</div>
        </div>
        <button class="clear-btn" id="clear-default" type="button">Clear</button>
      </div>
    `;
    document.getElementById('clear-default').addEventListener('click', () => {
      chrome.storage.local.remove('defaultCountryCode', () => {
        currentDefault = null;
        renderCurrentDefault();
        renderCountries(searchInput.value);
      });
    });
  } else {
    currentDefaultBox.innerHTML = `
      <div class="no-default">No default â€” Algerian 05/06/07 still auto-detect</div>
    `;
  }
}

function renderCountries(filter = '') {
  const items = COMMON_COUNTRY_CODES.filter(
    (c) =>
      c.country.toLowerCase().includes(filter.toLowerCase()) || c.code.includes(filter)
  );

  countriesList.innerHTML = items
    .map(
      (c) => `
    <div class="country-item ${currentDefault === c.code ? 'selected' : ''}" data-code="${c.code}">
      <span class="country-flag">${c.flag}</span>
      <span class="country-name">${c.country}</span>
      <span class="country-code">${c.code}</span>
    </div>
  `
    )
    .join('');

  countriesList.querySelectorAll('.country-item').forEach((item) => {
    item.addEventListener('click', () => {
      const code = item.dataset.code;
      chrome.storage.local.set({ defaultCountryCode: code }, () => {
        currentDefault = code;
        renderCurrentDefault();
        renderCountries(filter);
      });
    });
  });
}

document.querySelectorAll('#target-segmented .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    preferredTarget = btn.dataset.target;
    chrome.storage.local.set({ preferredTarget });
    renderTargetButtons();
  });
});

detectionToggle.addEventListener('change', () => {
  detectionEnabled = detectionToggle.checked;
  chrome.storage.local.set({ detectionEnabled });
});

cooldownInput.addEventListener('change', () => {
  let v = parseInt(cooldownInput.value, 10);
  if (Number.isNaN(v) || v < 0) v = 0;
  if (v > 1440) v = 1440;
  cooldownMinutes = v;
  cooldownInput.value = String(v);
  chrome.storage.local.set({ cooldownMinutes: v });
});

document.querySelectorAll('#domain-mode-segmented .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    domainMode = btn.dataset.mode === 'allowlist' ? 'allowlist' : 'all';
    chrome.storage.local.set({ domainMode });
    renderDomainMode();
  });
});

document.getElementById('domain-add-btn').addEventListener('click', () => {
  if (addDomain(domainInput.value)) domainInput.value = '';
  else domainInput.focus();
});

domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (addDomain(domainInput.value)) domainInput.value = '';
  }
});

document.getElementById('add-current-site').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url) return;
    try {
      const u = new URL(tab.url);
      if (!addDomain(u.hostname)) {
        // hard-blocked or invalid
        domainInput.placeholder = 'Canâ€™t add this site (WhatsApp / invalid)';
        setTimeout(() => {
          domainInput.placeholder = 'example.com';
        }, 2500);
      }
    } catch (_) {
      /* ignore */
    }
  });
});

chrome.storage.local.get(
  [
    'defaultCountryCode',
    'preferredTarget',
    'cooldownMinutes',
    'detectionEnabled',
    'domainMode',
    'scopedDomains'
  ],
  (result) => {
    currentDefault =
      result.defaultCountryCode !== undefined ? result.defaultCountryCode : '+213';
    preferredTarget = result.preferredTarget || 'app';
    cooldownMinutes =
      typeof result.cooldownMinutes === 'number' ? result.cooldownMinutes : 15;
    detectionEnabled = result.detectionEnabled !== false;
    domainMode = result.domainMode === 'allowlist' ? 'allowlist' : 'all';
    scopedDomains = Array.isArray(result.scopedDomains) ? result.scopedDomains : [];

    cooldownInput.value = String(cooldownMinutes);
    detectionToggle.checked = detectionEnabled;
    renderTargetButtons();
    renderDomainMode();
    renderDomainList();
    renderCurrentDefault();
    renderCountries();
  }
);

searchInput.addEventListener('input', (e) => {
  renderCountries(e.target.value);
});

const popupEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
})[character]);

function popupToast(message) {
  const toast = document.getElementById('popup-toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(popupToast.timer);
  popupToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function getLeadState(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const defaults = [
    { id: 'wholesale', name: 'Wholesalers', color: '#f6a723', hidden: false },
    { id: 'retail', name: 'Retailers', color: '#45b6a8', hidden: false },
    { id: 'follow-up', name: 'Follow up', color: '#7c8df2', hidden: false },
    { id: 'customer', name: 'Converted', color: '#48a868', hidden: false },
    { id: 'unknown', name: 'Unknown', color: '#9aa3ad', hidden: false },
    { id: 'irrelevant', name: 'Irrelevant', color: '#9a7b73', hidden: false }
  ];
  const mapped = Array.isArray(raw.folders) && raw.folders.length
    ? raw.folders.map((folder) => ({
      ...folder,
      id: folder.id,
      name: folder.name,
      color: folder.id === 'unknown' && (!folder.color || /^#(?:87938f|25d366)$/i.test(folder.color))
        ? '#9aa3ad'
        : (folder.color || '#25d366'),
      hidden: Boolean(folder.hidden)
    })).filter((folder) => folder.id && folder.name)
    : defaults;
  const folders = mapped.slice();
  [
    { id: 'unknown', name: 'Unknown', color: '#9aa3ad', hidden: false },
    { id: 'irrelevant', name: 'Irrelevant', color: '#9a7b73', hidden: false }
  ].forEach((folder) => {
    if (folders.some((item) => item.id === folder.id
      || String(item.name || '').toLocaleLowerCase() === folder.name.toLocaleLowerCase())) return;
    folders.push(folder);
  });
  return {
    ...raw,
    folders,
    contacts: raw.contacts && typeof raw.contacts === 'object' ? raw.contacts : {},
    groupingEnabled: raw.groupingEnabled !== false,
    autoFollowUpHours: Number.isFinite(Number(raw.autoFollowUpHours)) ? Math.max(0, Math.min(720, Number(raw.autoFollowUpHours))) : 24
  };
}

async function persistLeadState(state) {
  await chrome.storage.local.set({ waLeadFoldersState: state });
  renderLeadDesk(state);
}

function renderLeadDesk(raw) {
  const state = getLeadState(raw);
  const contacts = Object.values(state.contacts);
  const due = contacts.filter((contact) => contact.remindAt && Date.parse(contact.remindAt) <= Date.now()).length;
  const visibleCount = state.folders.filter((folder) => !folder.hidden).length;
  document.getElementById('desk-stats').innerHTML = `
    <div class="stat"><strong>${contacts.length}</strong><span>classified leads</span></div>
    <div class="stat"><strong>${visibleCount}</strong><span>visible folders</span></div>
    <div class="stat"><strong>${due}</strong><span>follow-ups due</span></div>`;
  const grouping = document.getElementById('grouping-toggle');
  grouping.textContent = state.groupingEnabled ? 'On' : 'Off';
  grouping.setAttribute('aria-pressed', String(state.groupingEnabled));
  document.getElementById('auto-followup-hours').value = state.autoFollowUpHours;
  document.getElementById('desk-folders').innerHTML = state.folders.length
    ? state.folders.map((folder, index) => {
      const count = contacts.filter((contact) => contact.folderId === folder.id).length;
      return `<div class="desk-folder${folder.hidden ? ' is-hidden' : ''}" data-folder-id="${popupEscape(folder.id)}">
        <div class="desk-folder-reorder">
          <button type="button" class="desk-folder-move" data-move="-1" aria-label="Move up" title="Move up" ${index === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="desk-folder-move" data-move="1" aria-label="Move down" title="Move down" ${index === state.folders.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <i style="--folder-color:${popupEscape(folder.color || '#25d366')}"></i>
        <span>${popupEscape(folder.name || 'Unnamed folder')}${folder.hidden ? ' · hidden' : ''}</span>
        <b>${count}</b>
        <button type="button" class="desk-folder-action" data-action="toggle-hidden" aria-label="${folder.hidden ? 'Show' : 'Hide'} folder" title="${folder.hidden ? 'Show' : 'Hide'}">${folder.hidden ? '○' : '●'}</button>
        <button type="button" class="desk-folder-action is-danger" data-action="delete" aria-label="Delete folder" title="Delete">×</button>
      </div>`;
    }).join('')
    : '<div class="domain-empty">No folders yet — open Lead desk in WhatsApp to create one.</div>';

  document.querySelectorAll('#desk-folders .desk-folder').forEach((row) => {
    const folderId = row.dataset.folderId;
    const folder = state.folders.find((item) => item.id === folderId);
    if (!folder) return;
    row.querySelectorAll('.desk-folder-move').forEach((button) => {
      button.addEventListener('click', async () => {
        const index = state.folders.findIndex((item) => item.id === folderId);
        const next = index + Number(button.dataset.move);
        if (index < 0 || next < 0 || next >= state.folders.length) return;
        const ordered = state.folders.slice();
        const [item] = ordered.splice(index, 1);
        ordered.splice(next, 0, item);
        state.folders = ordered;
        await persistLeadState(state);
        popupToast(`Reordered ${folder.name}`);
      });
    });
    row.querySelector('[data-action="toggle-hidden"]').addEventListener('click', async () => {
      folder.hidden = !folder.hidden;
      await persistLeadState(state);
      popupToast(folder.hidden
        ? `${folder.name} hidden from list — still assignable`
        : `${folder.name} is shown in the list again`);
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      const count = contacts.filter((contact) => contact.folderId === folder.id).length;
      const ok = window.confirm(
        count
          ? `Delete "${folder.name}"? ${count} lead${count === 1 ? '' : 's'} will be unassigned.`
          : `Delete "${folder.name}"?`
      );
      if (!ok) return;
      state.folders = state.folders.filter((item) => item.id !== folder.id);
      Object.keys(state.contacts || {}).forEach((id) => {
        if (state.contacts[id]?.folderId === folder.id) delete state.contacts[id];
      });
      if (state.folderRules) delete state.folderRules[folder.id];
      if (state.replySequences) delete state.replySequences[folder.id];
      if (state.quickReplies) delete state.quickReplies[folder.id];
      await persistLeadState(state);
      popupToast(`${folder.name} deleted`);
    });
  });

  grouping.onclick = async () => {
    state.groupingEnabled = !state.groupingEnabled;
    await persistLeadState(state);
    popupToast(`Inline grouping ${state.groupingEnabled ? 'enabled' : 'disabled'}`);
  };
  document.getElementById('auto-followup-hours').onchange = async (event) => {
    state.autoFollowUpHours = Math.max(0, Math.min(720, Number(event.target.value) || 0));
    event.target.value = state.autoFollowUpHours;
    await chrome.storage.local.set({ waLeadFoldersState: state });
    popupToast(state.autoFollowUpHours ? `Follow-up set to ${state.autoFollowUpHours} hours` : 'Automatic follow-up disabled');
  };
}

function openLeadDesk() {
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    const tab = [...(tabs || [])].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (!tab?.id) {
      chrome.tabs.create({ url: 'https://web.whatsapp.com/', active: true });
      return;
    }
    chrome.tabs.update(tab.id, { active: true });
    chrome.tabs.sendMessage(tab.id, { type: 'WALF_OPEN_PANEL' }, () => {
      void chrome.runtime.lastError;
    });
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const selected = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.getElementById('quick-panel').hidden = selected !== 'quick';
    document.getElementById('desk-panel').hidden = selected !== 'desk';
  });
});

document.getElementById('open-lead-desk').addEventListener('click', openLeadDesk);
chrome.storage.local.get('waLeadFoldersState', (result) => renderLeadDesk(result.waLeadFoldersState));
