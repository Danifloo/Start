/** Pure helpers independent of Cloudflare runtime. */
export const QUARTER_HOUR_MS = 15 * 60 * 1000;
export const MAX_LATE_MS = 12 * 60 * 1000;

export function isQuarterHour(ms) {
  return Number.isSafeInteger(ms) && ms % QUARTER_HOUR_MS === 0;
}

export function parseScheduled(iso, now = Date.now()) {
  if (typeof iso !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(iso)) {
    throw new Error('Fecha obligatoria con zona horaria ISO (ej. 2026-10-15T20:15:00-04:00).');
  }
  const ms = Date.parse(iso);
  if (!isQuarterHour(ms)) throw new Error('El horario debe caer en los minutos 00, 15, 30 o 45, sin segundos.');
  if (ms <= now + 60_000) throw new Error('Programa al menos un minuto en el futuro.');
  if (ms > now + 30 * 24 * 60 * 60 * 1000) throw new Error('Máximo treinta días en el futuro.');
  return ms;
}

export function normalizeHeadline(title) {
  return String(title || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function publicHttpsUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || !h.includes('.')) return false;
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return false;
    return true;
  } catch { return false; }
}

export function validatePost(data, now = Date.now()) {
  if (!data || typeof data !== 'object') throw new Error('Introduce la publicación.');
  const title = normalizeHeadline(data.title);
  const caption = String(data.caption || '').trim();
  const source = String(data.source_url || '').trim();
  const rights = String(data.image_rights || '').trim();
  const images = data.images;
  if (title.length < 12 || title.length > 180) throw new Error('Titular: entre 12 y 180 caracteres.');
  if (caption.length < 30 || caption.length > 2200) throw new Error('Descripción: entre 30 y 2.200 caracteres.');
  if (!publicHttpsUrl(source)) throw new Error('La fuente debe tener URL HTTPS pública.');
  if (rights.length < 12 || rights.length > 1000) throw new Error('Indica los créditos y derechos de uso de las fotos.');
  if (!Array.isArray(images) || images.length < 2 || images.length > 10 || images.some(x => !publicHttpsUrl(x))) {
    throw new Error('Se necesitan de dos a diez imágenes con URL HTTPS pública.');
  }
  if (new Set(images).size !== images.length) throw new Error('No repitas imágenes dentro de un carrusel.');
  const scheduled_ms = parseScheduled(data.scheduled_at, now);
  return {title, caption, source_url: source, image_rights: rights, images, scheduled_ms};
}

export function checkQuota(payload) {
  const obj = Array.isArray(payload?.data) ? payload.data[0] : payload;
  const used = obj?.quota_usage;
  const total = obj?.config?.quota_total;
  if (!Number.isInteger(used) || !Number.isInteger(total) || total < 1) {
    throw new Error('Meta no confirmó la cuota real; publicación bloqueada por seguridad.');
  }
  return {used, total, remaining: Math.max(0,total-used), available:used<total};
}

export function sameAccount(profile, expectedId, expectedName) {
  return String(profile?.id || '') === String(expectedId || '') &&
    String(profile?.username || '').replace(/^@/,'').toLowerCase() === String(expectedName || '').replace(/^@/,'').toLowerCase();
}
