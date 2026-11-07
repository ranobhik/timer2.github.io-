/* Утилиты: DOM, строки, даты, ид, безопасность разметки. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Экранирование текста для вставки в HTML. */
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Экранирование для значений атрибутов. */
export const attr = esc;

/** Безопасный URL: только http(s), относительные пути и data:image. */
export function safeUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  if (/^(https?:)?\/\//i.test(raw)) return raw;
  if (/^\/|^\.\//.test(raw)) return raw;
  if (/^data:image\//i.test(raw)) return raw;
  return "";
}

/** Транслитерация для человекочитаемых id. */
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function slugify(str) {
  const base = String(str ?? "")
    .toLowerCase()
    .split("")
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "anime";
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function debounce(fn, ms = 220) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function plural(n, one, few, many) {
  const num = Math.abs(Number(n)) % 100;
  const last = num % 10;
  if (num > 10 && num < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function formatDate(iso) {
  if (!iso) return "";
  const raw = String(iso);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function timeAgo(iso) {
  const time = new Date(iso).getTime();
  if (!time) return "";
  const diff = Math.max(0, Date.now() - time);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} ${plural(min, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  return formatDate(iso);
}

/** Стабильный оттенок по строке — для градиентных постеров. */
export function hueFrom(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i += 1) {
    h = (h * 31 + String(str).charCodeAt(i)) % 360;
  }
  return h;
}

export function initials(title) {
  const words = String(title ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "★";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const STATUS_LABELS = {
  ongoing: "Онгоинг",
  released: "Завершён",
  announced: "Анонс",
  hiatus: "Перерыв",
};

export const PLAYER_TYPES = {
  iframe: "Iframe по ссылке",
  html: "Код вставки (embed)",
  video: "Видео / .mp4",
  demo: "Заглушка (демо)",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || "—";
}

export function pluralEpisodes(n) {
  return `${n} ${plural(n, "эпизод", "эпизода", "эпизодов")}`;
}

/** Глубокая копия простых объектов/массивов. */
export function clone(value) {
  if (typeof structuredClone === "function") {
    try { return structuredClone(value); } catch { /* fallthrough */ }
  }
  return JSON.parse(JSON.stringify(value));
}

/** Простой хэш (используется только для локального пароля админки). */
export function hashString(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
