/**
 * Shared phone helpers (background via importScripts, content via script tag).
 * Tuned for Algerian mobiles (05/06/07) and international +213 forms.
 */

/**
 * Flexible DZ mobile pattern (spaces / dots / dashes optional).
 * - Local: 0[567] + 8 digits  â†’ 0555 01 06 06
 * - Intl:  (+|00)?213 + optional trunk 0 + [567] + 8 digits
 */
// eslint-disable-next-line no-unused-vars
const WA_DZ_PHONE_SOURCE =
  '(?:(?:\\+|00)?213[\\s.\\-]*0?[567](?:[\\s.\\-]*\\d){8}|0[567](?:[\\s.\\-]*\\d){8})';

function waStripToLooseDigits(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function waHasCountryCode(number) {
  const cleaned = waStripToLooseDigits(number);
  return cleaned.startsWith('+') || cleaned.startsWith('00') || /^213[567]/.test(cleaned.replace(/^\+/, ''));
}

/**
 * Normalize any supported number to WhatsApp digits (no +).
 * Returns null if it cannot be normalized confidently.
 */
function waNormalizeNumber(raw, defaultCountryCode) {
  if (raw == null || String(raw).trim() === '') return null;

  // Prefer Algerian-aware parse first
  const dz = waNormalizeAlgerian(raw);
  if (dz) return dz;

  let cleaned = waStripToLooseDigits(raw);
  if (!cleaned) return null;

  if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // Bare international already (long enough)
  if (cleaned.length >= 10 && !cleaned.startsWith('0') && defaultCountryCode) {
    const codeDigits = String(defaultCountryCode).replace(/[^\d]/g, '');
    if (cleaned.startsWith(codeDigits)) {
      return cleaned;
    }
  }

  if (defaultCountryCode) {
    const codeDigits = String(defaultCountryCode).replace(/[^\d]/g, '');
    cleaned = cleaned.replace(/^0+/, '');
    if (!cleaned.startsWith(codeDigits)) {
      cleaned = codeDigits + cleaned;
    }
    return cleaned;
  }

  // Already looks international
  if (cleaned.length >= 11 && !cleaned.startsWith('0')) {
    return cleaned;
  }

  return null;
}

/**
 * Algerian mobile â†’ 213XXXXXXXXX (9 subscriber digits after 213).
 * Accepts:
 *   0555 01 06 06, 0555010606
 *   213 555 01 06 06, 2130555010606
 *   +213 555 01 06 06, 00213...
 */
function waNormalizeAlgerian(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (!d) return null;

  // Strip leading 00
  if (d.startsWith('00')) d = d.slice(2);

  // 2130[567]XXXXXXXX â†’ drop trunk 0
  if (d.startsWith('2130') && d.length >= 13) {
    d = '213' + d.slice(4);
  }

  // 213[567]XXXXXXXX (12 digits)
  if (/^213[567]\d{8}$/.test(d)) {
    return d;
  }

  // Local 0[567]XXXXXXXX (10 digits)
  if (/^0[567]\d{8}$/.test(d)) {
    return '213' + d.slice(1);
  }

  // Local without leading 0: [567]XXXXXXXX (9 digits) â€” only if clearly mobile
  if (/^[567]\d{8}$/.test(d)) {
    return '213' + d;
  }

  return null;
}

function waBuildWhatsAppUrl(phoneDigits, action, target) {
  const type = action === 'call' ? 'call' : 'phone_number';
  const query = `phone=${phoneDigits}&text&type=${type}&app_absent=0`;
  if (target === 'web') {
    return `https://web.whatsapp.com/send/?${query}`;
  }
  return `https://api.whatsapp.com/send/?${query}`;
}

function waFormatDisplay(digits) {
  if (!digits) return '';
  if (digits.startsWith('213') && digits.length === 12) {
    const local = '0' + digits.slice(3);
    // 0555 01 06 06
    return local.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4');
  }
  return '+' + digits;
}

/** Minutes since ts; null if no ts */
function waMinutesSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 60000);
}

/**
 * Hosts where on-page detection must never run (WhatsApp itself, etc.).
 * Matching is subdomain-aware (e.g. web.whatsapp.com matches whatsapp.com).
 */
const WA_HARD_BLOCKED_HOSTS = [
  'whatsapp.com',
  'whatsapp.net',
  'wa.me',
  'wa.works'
];

function waNormalizeHost(host) {
  return String(host || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^\.+/, '')
    .replace(/^www\./, '');
}

/** hostname matches pattern or is a subdomain of pattern */
function waHostMatchesPattern(hostname, pattern) {
  const h = waNormalizeHost(hostname);
  let p = waNormalizeHost(pattern);
  if (p.startsWith('*.')) p = p.slice(2);
  if (!h || !p) return false;
  return h === p || h.endsWith('.' + p);
}

function waIsHardBlockedHost(hostname) {
  const h = waNormalizeHost(hostname);
  if (!h) return true;
  return WA_HARD_BLOCKED_HOSTS.some((b) => waHostMatchesPattern(h, b));
}

/**
 * Whether on-page highlight/detection may run on this host.
 * - Always false on WhatsApp domains
 * - domainMode "all": everywhere else (minus optional blockedDomains)
 * - domainMode "allowlist": only scopedDomains entries
 */
function waIsDetectionAllowedOnHost(hostname, settings) {
  if (!settings || settings.detectionEnabled === false) return false;
  if (waIsHardBlockedHost(hostname)) return false;

  const mode = settings.domainMode || 'all';
  const scoped = Array.isArray(settings.scopedDomains) ? settings.scopedDomains : [];
  const blocked = Array.isArray(settings.blockedDomains) ? settings.blockedDomains : [];

  if (blocked.some((p) => waHostMatchesPattern(hostname, p))) return false;

  if (mode === 'allowlist') {
    if (!scoped.length) return false;
    return scoped.some((p) => waHostMatchesPattern(hostname, p));
  }

  // "all" â€” every site except hard-blocked / extra blocked
  return true;
}

function waParseDomainInput(input) {
  const h = waNormalizeHost(input);
  if (!h || !h.includes('.')) {
    // allow localhost / single-label only if explicitly localhost
    if (h === 'localhost') return h;
    return null;
  }
  // basic sanity: no spaces
  if (/\s/.test(h)) return null;
  return h;
}


