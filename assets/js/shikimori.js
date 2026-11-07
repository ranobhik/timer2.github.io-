/* Автоподгрузка постеров с Shikimori (публичный API, работает из браузера).
   Запросы кешируются в localStorage, поэтому повторные загрузки мгновенные. */

const API_BASE = "https://shikimori.one/api";
const CACHE_KEY = "rp.posters.v1";
const SITE = "https://shikimori.one";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 дней

/* ---------- Кеш ---------- */
function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* нет места — просто не кешируем */
  }
}

export function getCachedPoster(key) {
  if (!key) return "";
  const item = readCache()[key];
  if (!item || !item.url) return "";
  if (item.at && Date.now() - item.at > CACHE_TTL) return "";
  return item.url;
}

export function setCachedPoster(key, url) {
  if (!key || !url) return;
  const cache = readCache();
  cache[key] = { url, at: Date.now() };
  writeCache(cache);
}

/** Прямой URL постера по ID: <img> грузится без CORS и без запросов к API. */
export function posterUrlById(id) {
  const clean = String(id || "").replace(/\D/g, "");
  return clean ? `${SITE}/system/animes/original/${clean}.jpg` : "";
}

/** Shikimori отдаёт относительные пути — приводим к абсолютному URL. */
export function absoluteShikimoriUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${SITE}${raw}`;
  return raw;
}

/* ---------- HTTP ---------- */
async function request(path, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Shikimori: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getAnimeById(id) {
  return request(`/animes/${encodeURIComponent(String(id).trim())}`);
}

export async function searchAnime(query) {
  const list = await request(`/animes?search=${encodeURIComponent(query)}&limit=1&order=popularity`);
  return Array.isArray(list) && list.length ? list[0] : null;
}

/* ---------- Преобразование ---------- */
export function pickPoster(data) {
  return absoluteShikimoriUrl(data?.image?.original || data?.image?.preview || "");
}

function htmlToText(html) {
  if (!html) return "";
  const holder = document.createElement("div");
  holder.innerHTML = String(html);
  holder.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  holder.querySelectorAll("p, div, li").forEach((block) => block.append("\n"));
  return holder.textContent || "";
}

export function stripBbcode(text = "") {
  return String(text)
    .replace(/\[\/?[a-z][^\]]*\]/gi, "")
    .replace(/\{\{.*?\}\}/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mapShikimori(data) {
  if (!data || typeof data !== "object") return null;
  const dateSource = data.aired_on || data.released_on || "";
  const year = dateSource ? Number(String(dateSource).slice(0, 4)) : NaN;
  const score = Number(data.score);
  return {
    shikimoriId: data.id ? String(data.id) : "",
    poster: pickPoster(data),
    title: data.russian || data.name || "",
    originalTitle: data.name || "",
    year: Number.isFinite(year) && year > 1900 ? year : undefined,
    rating: Number.isFinite(score) && score > 0 ? Math.min(10, Math.max(0, score)) : undefined,
    genres: (Array.isArray(data.genres) ? data.genres : [])
      .map((genre) => genre?.russian || genre?.name || "")
      .filter(Boolean),
    description: (data.description_html ? htmlToText(data.description_html) : stripBbcode(data.description || ""))
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 2500),
    episodes: Number(data.episodes) || undefined,
    status: data.status || "",
    kind: data.kind || "",
  };
}

/** Ищет тайтл по id, а если id нет — по названию. Возвращает данные или null. */
export async function resolveByShikimori({ shikimoriId, title, originalTitle } = {}, { allowSearch = true } = {}) {
  const id = String(shikimoriId || "").trim();
  if (id) {
    try {
      const data = await getAnimeById(id);
      if (data && data.id) return mapShikimori(data);
    } catch (error) {
      console.debug("Shikimori id:", error?.message);
      if (!allowSearch) throw error;
    }
  }
  if (!allowSearch) return null;
  const query = String(originalTitle || title || "").trim();
  if (!query) return null;
  const found = await searchAnime(query);
  return mapShikimori(found);
}

/** Для админки: сначала API (год, жанры, описание), при недоступности — постер по ID. */
export async function fetchPosterSmart(input = {}) {
  const id = String(input.shikimoriId || "").replace(/\D/g, "");
  try {
    const data = await resolveByShikimori(input);
    if (data) {
      if (!data.poster && id) data.poster = posterUrlById(id);
      return data;
    }
  } catch (error) {
    if (!id) throw error;
    return {
      shikimoriId: id,
      poster: posterUrlById(id),
      title: input.title || "",
      originalTitle: input.originalTitle || "",
      fallback: true,
      error: error?.message || "",
    };
  }
  if (id) {
    return {
      shikimoriId: id,
      poster: posterUrlById(id),
      title: input.title || "",
      fallback: true,
    };
  }
  return null;
}

/* ---------- Гидратация каталога ---------- */
export function posterCacheKey(anime) {
  if (!anime) return "";
  return anime.shikimoriId ? `id:${anime.shikimoriId}` : `q:${String(anime.title || "").toLowerCase()}`;
}

/** Подставляет постеры из кеша или строит прямой URL по Shikimori ID (без сети). */
export function applyCachedPosters(catalog) {
  let changed = false;
  (catalog?.anime || []).forEach((anime) => {
    if (anime.poster) return;
    const cached = getCachedPoster(posterCacheKey(anime));
    if (cached) {
      anime.poster = cached;
      changed = true;
      return;
    }
    if (anime.shikimoriId) {
      anime.poster = posterUrlById(anime.shikimoriId);
      changed = true;
    }
  });
  return changed;
}
