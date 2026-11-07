/* Хранилище: каталог (data/catalog.json), локальный черновик админки,
   настройки пользователя и «авторизация» админки. */

import { clone, hashString, slugify, uid } from "./utils.js";

const DRAFT_KEY = "rp.draft.v1";
const PREFS_KEY = "rp.prefs.v1";
const PASS_KEY = "rp.pass.v1";
const SESSION_KEY = "rp.session.v1";
export const DEFAULT_PASSWORD = "rabpartiya";

/* ---------- Безопасная обёртка над storage ---------- */
const memory = new Map();
function safeGet(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? memory.get(key) ?? null : value;
  } catch {
    return memory.get(key) ?? null;
  }
}
function safeSet(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* приватный режим / переполнение — работаем из памяти */
  }
}
function safeRemove(key) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/* ================= Настройки сайта по умолчанию ================= */
export const DEFAULT_SETTINGS = {
  siteName: "Рабочая партия",
  tagline: "аниме онлайн",
  description:
    "Аниме-портал команды «Рабочая партия»: каталог, эпизоды и плееры. Смотрите с любого устройства.",
  logo: "",
  accent: "#f43f5e",
  accent2: "#8b5cf6",
  theme: "dark",
  announcement: {
    enabled: true,
    text: "Добро пожаловать на «Рабочую партию»! Новые серии добавляются каждый день.",
  },
  nav: [
    { label: "Главная", href: "#/", enabled: true },
    { label: "Каталог", href: "#/catalog", enabled: true },
    { label: "Избранное", href: "#/favorites", enabled: true },
    { label: "О проекте", href: "#/about", enabled: true },
  ],
  socials: { telegram: "", discord: "", vk: "", youtube: "", github: "" },
  footerText: "© 2026 «Рабочая партия». Все права на произведения принадлежат их авторам.",
  heroMode: "featured",
  continueWatching: true,
  playerNote: "",
  customCss: "",
};

export const DEFAULT_GENRES = [
  "Экшен", "Приключения", "Фэнтези", "Комедия", "Драма",
  "Романтика", "Триллер", "Мистика", "Фантастика", "Спорт", "Сёнен", "Сёдзё",
];

/* ================= Нормализация данных ================= */
function normalizeSettings(raw = {}) {
  const merged = { ...clone(DEFAULT_SETTINGS), ...(raw && typeof raw === "object" ? raw : {}) };
  merged.announcement = {
    ...DEFAULT_SETTINGS.announcement,
    ...(raw?.announcement && typeof raw.announcement === "object" ? raw.announcement : {}),
  };
  merged.socials = {
    ...DEFAULT_SETTINGS.socials,
    ...(raw?.socials && typeof raw.socials === "object" ? raw.socials : {}),
  };
  merged.nav = Array.isArray(raw?.nav) && raw.nav.length
    ? raw.nav
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          label: String(item.label ?? "Ссылка"),
          href: String(item.href ?? "#/"),
          enabled: item.enabled !== false,
        }))
    : clone(DEFAULT_SETTINGS.nav);
  merged.siteName = String(merged.siteName || DEFAULT_SETTINGS.siteName);
  return merged;
}

export function normalizePlayer(raw, index = 0) {
  const type = ["iframe", "html", "video", "demo"].includes(raw?.type) ? raw.type : "demo";
  return {
    id: String(raw?.id || uid("pl")),
    name: String(raw?.name || `Плеер ${index + 1}`),
    type,
    url: String(raw?.url || ""),
    code: String(raw?.code || ""),
  };
}

export function normalizeEpisode(raw, index = 0, animeId = "") {
  const episode = raw && typeof raw === "object" ? raw : {};
  const players = Array.isArray(episode.players) ? episode.players.map(normalizePlayer) : [];
  if (!players.length) {
    players.push({ id: uid("pl"), name: "Плеер 1", type: "demo", url: "", code: "" });
  }
  return {
    id: String(episode.id || `${animeId}-ep-${index + 1}`),
    number: Number(episode.number) > 0 ? Number(episode.number) : index + 1,
    title: String(episode.title || ""),
    date: String(episode.date || ""),
    duration: String(episode.duration || ""),
    players,
  };
}

export function normalizeAnime(raw, index = 0) {
  const item = raw && typeof raw === "object" ? raw : {};
  const title = String(item.title || "").trim() || `Аниме ${index + 1}`;
  const id = String(item.id || slugify(title));
  const episodes = Array.isArray(item.episodes)
    ? item.episodes.map((ep, i) => normalizeEpisode(ep, i, id)).sort((a, b) => a.number - b.number)
    : [];
  return {
    id,
    title,
    originalTitle: String(item.originalTitle || ""),
    year: Number(item.year) || new Date().getFullYear(),
    status: ["ongoing", "released", "announced", "hiatus"].includes(item.status) ? item.status : "ongoing",
    genres: Array.isArray(item.genres) ? item.genres.map(String).filter(Boolean) : [],
    rating: Math.max(0, Math.min(10, Number(item.rating) || 0)),
    ageRating: String(item.ageRating || ""),
    description: String(item.description || ""),
    poster: String(item.poster || ""),
    banner: String(item.banner || ""),
    studio: String(item.studio || ""),
    director: String(item.director || ""),
    country: String(item.country || "Япония"),
    tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
    published: item.published !== false,
    featured: item.featured === true,
    createdAt: String(item.createdAt || new Date().toISOString()),
    episodes,
  };
}

export function normalizeCatalog(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const genres = Array.isArray(src.genres) && src.genres.length
    ? Array.from(new Set(src.genres.map((g) => String(g).trim()).filter(Boolean)))
    : [...DEFAULT_GENRES];
  const anime = Array.isArray(src.anime) ? src.anime.map(normalizeAnime).filter((a) => a.title) : [];
  const seen = new Set();
  anime.forEach((item) => {
    let id = item.id;
    let n = 2;
    while (seen.has(id)) { id = `${item.id}-${n}`; n += 1; }
    seen.add(id);
    item.id = id;
  });
  return {
    version: 1,
    updatedAt: String(src.updatedAt || ""),
    settings: normalizeSettings(src.settings),
    genres,
    anime,
  };
}

/* ================= Загрузка каталога ================= */
let state = {
  catalog: null,
  source: "default", // catalog | draft | default
  draftSavedAt: "",
  loadError: "",
};

export async function loadCatalog() {
  let base = null;
  try {
    const url = new URL("data/catalog.json", document.baseURI);
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    base = await res.json();
    state.source = "catalog";
  } catch (error) {
    state.loadError = error?.message || "не удалось загрузить data/catalog.json";
    base = null;
  }

  let catalog = normalizeCatalog(base);

  const draft = loadDraft();
  if (draft) {
    catalog = normalizeCatalog(draft.data);
    state.source = "draft";
    state.draftSavedAt = draft.savedAt || "";
  }

  state.catalog = catalog;
  return catalog;
}

export function getState() {
  return state;
}
export function getCatalog() {
  return state.catalog;
}
export function setCatalog(next) {
  state.catalog = normalizeCatalog(next);
  return state.catalog;
}
export function patchSettings(patch) {
  state.catalog.settings = normalizeSettings({ ...state.catalog.settings, ...patch });
  return state.catalog.settings;
}

/* ================= Черновик админки ================= */
export function loadDraft() {
  const raw = safeGet(DRAFT_KEY) ?? draftFallback;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

let draftFallback = null;

export function saveDraft(catalog) {
  const savedAt = new Date().toISOString();
  const data = normalizeCatalog({ ...catalog, updatedAt: savedAt });
  const payload = JSON.stringify({ savedAt, data });
  try {
    window.localStorage.setItem(DRAFT_KEY, payload);
  } catch {
    // localStorage недоступен или переполнен
    draftFallback = payload;
    throw new Error(
      "Не удалось сохранить: браузер не даёт место в localStorage (лимит ~5 МБ). " +
      "Уберите загруженные картинки или используйте ссылки на постеры.",
    );
  }
  state.catalog = data;
  state.source = "draft";
  state.draftSavedAt = savedAt;
  return savedAt;
}

export function discardDraft() {
  safeRemove(DRAFT_KEY);
  state.draftSavedAt = "";
}

export function hasDraft() {
  return Boolean(safeGet(DRAFT_KEY));
}

export function exportJSON(catalog = state.catalog) {
  const data = {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: catalog.settings,
    genres: catalog.genres,
    anime: catalog.anime,
  };
  return JSON.stringify(data, null, 2);
}

export function downloadJSON(filename = "catalog.json") {
  const blob = new Blob([exportJSON()], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ================= Пользовательские настройки ================= */
const DEFAULT_PREFS = {
  theme: "",           // "" = тема из настроек сайта
  favorites: [],
  history: [],         // { animeId, episodeId, progress, at }
};

export function getPrefs() {
  const raw = safeGet(PREFS_KEY);
  if (!raw) return clone(DEFAULT_PREFS);
  try {
    const parsed = JSON.parse(raw);
    return {
      ...clone(DEFAULT_PREFS),
      ...parsed,
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.map(String) : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return clone(DEFAULT_PREFS);
  }
}

export function savePrefs(prefs) {
  safeSet(PREFS_KEY, JSON.stringify(prefs));
  return prefs;
}

export function updatePrefs(patch) {
  return savePrefs({ ...getPrefs(), ...patch });
}

export function toggleFavorite(animeId) {
  const prefs = getPrefs();
  const has = prefs.favorites.includes(animeId);
  prefs.favorites = has
    ? prefs.favorites.filter((id) => id !== animeId)
    : [animeId, ...prefs.favorites];
  savePrefs(prefs);
  return !has;
}

export function isFavorite(animeId) {
  return getPrefs().favorites.includes(animeId);
}

export function recordHistory(animeId, episodeId, extra = {}) {
  const prefs = getPrefs();
  const current = prefs.history.find((item) => item.animeId === animeId);
  const merged = {
    animeId,
    episodeId,
    progress: current?.episodeId === episodeId ? current.progress || 0 : 0,
    at: new Date().toISOString(),
    ...extra,
  };
  prefs.history = [merged, ...prefs.history.filter((item) => item.animeId !== animeId)].slice(0, 40);
  savePrefs(prefs);
  return merged;
}

export function getHistoryItem(animeId) {
  return getPrefs().history.find((item) => item.animeId === animeId) || null;
}

/* ================= «Авторизация» админки =================
   Внимание: это статический сайт, поэтому пароль — только локальная
   защита от случайных правок. Не используйте важные пароли. */
export function checkPassword(password) {
  const stored = safeGet(PASS_KEY);
  if (!stored) return password === DEFAULT_PASSWORD;
  return hashString(`rp::${password}`) === stored;
}

export function setPassword(newPassword) {
  safeSet(PASS_KEY, hashString(`rp::${newPassword}`));
}

export function hasCustomPassword() {
  return Boolean(safeGet(PASS_KEY));
}

export function login(password, remember = true) {
  if (!checkPassword(password)) return false;
  if (remember) {
    try { window.sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }
  }
  sessionCache = true;
  return true;
}

let sessionCache = false;
export function isAdmin() {
  if (sessionCache) return true;
  try {
    sessionCache = window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    sessionCache = false;
  }
  return sessionCache;
}

export function logout() {
  sessionCache = false;
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/* ================= Селекторы ================= */
export function getAnime(id) {
  if (!state.catalog) return null;
  return state.catalog.anime.find((item) => item.id === id) || null;
}

export function publicAnime() {
  return (state.catalog?.anime || []).filter((item) => item.published);
}

export function animeEpisodes(anime) {
  return [...(anime?.episodes || [])].sort((a, b) => a.number - b.number);
}

export function findEpisode(anime, episodeIdOrNumber) {
  if (!anime) return null;
  const key = String(episodeIdOrNumber ?? "");
  return (
    anime.episodes.find((ep) => ep.id === key) ||
    anime.episodes.find((ep) => String(ep.number) === key) ||
    null
  );
}

export function genreCounts() {
  const counts = new Map();
  (state.catalog?.genres || []).forEach((g) => counts.set(g, 0));
  publicAnime().forEach((item) => {
    item.genres.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1));
  });
  return counts;
}

export function watchHref(anime, episode) {
  return `#/watch/${anime.id}/${episode ? episode.id : "1"}`;
}
