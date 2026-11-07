/* Автоподгрузка постеров с Shikimori (публичный API, работает из браузера).
   Запросы кешируются в localStorage, поэтому повторные загрузки мгновенные. */

/* shikimori.one отвечает 301 на shikimori.io; у редиректа нет CORS-заголовков,
   поэтому в браузере запрос падает. Ходим сразу на shikimori.io, с запасным хостом. */
const API_HOSTS = ["https://shikimori.io/api", "https://shikimori.one/api"];
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
async function requestOnce(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Shikimori: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function request(path, timeout = 9000) {
  let lastError = null;
  for (const host of API_HOSTS) {
    try {
      return await requestOnce(`${host}${path}`, timeout);
    } catch (error) {
      lastError = error;
      if (/HTTP 4\d\d/.test(error?.message || "")) break;
    }
  }
  if (lastError instanceof TypeError || /fetch|network/i.test(lastError?.message || "")) {
    throw new Error("Нет связи с Shikimori (VPN, блокировщик или офлайн)");
  }
  throw lastError;
}

export async function getAnimeById(id) {
  return request(`/animes/${encodeURIComponent(String(id).trim())}`);
}

export async function searchAnime(query) {
  const list = await request(`/animes?search=${encodeURIComponent(query)}&limit=1&order=popularity`);
  return Array.isArray(list) && list.length ? list[0] : null;
}

/* Полные данные тайтла кешируем: описание, жанры, MAL ID меняются редко */
const DETAILS_KEY = "rp.details.v1";

function readDetails() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DETAILS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDetails(cache) {
  try {
    window.localStorage.setItem(DETAILS_KEY, JSON.stringify(cache));
  } catch {
    /* нет места — не кешируем */
  }
}

export function getCachedDetails(id) {
  const key = String(id || "").replace(/\D/g, "");
  if (!key) return null;
  const item = readDetails()[key];
  if (!item || !item.at) return null;
  if (Date.now() - item.at > CACHE_TTL) return null;
  return item.data || null;
}

export async function getAnimeDetails(id) {
  const key = String(id || "").replace(/\D/g, "");
  if (!key) return null;
  const cached = getCachedDetails(key);
  if (cached) return cached;
  const data = await getAnimeById(key);
  const mapped = mapShikimori(data);
  if (mapped) {
    const cache = readDetails();
    cache[key] = { at: Date.now(), data: mapped };
    writeDetails(cache);
  }
  return mapped;
}

/** Пакетная загрузка: /animes?ids=1,2,3 — 30 id за запрос, ответ кешируется в localStorage. */
export async function getShikimoriBatch(ids = []) {
  const clean = [...new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").replace(/\D/g, ""))
    .filter(Boolean))];
  const out = {};
  for (let i = 0; i < clean.length; i += 30) {
    const chunk = clean.slice(i, i + 30);
    try {
      const data = await request(`/animes?ids=${chunk.join(",")}&limit=${chunk.length}`);
      (Array.isArray(data) ? data : []).forEach((raw) => {
        const mapped = mapShikimori(raw);
        if (mapped) out[String(raw.id)] = mapped;
      });
    } catch (error) {
      console.debug("Shikimori batch:", error?.message);
    }
  }
  return out;
}

/* ---------- Преобразование ---------- */
export function pickPoster(data) {
  const raw = String(data?.image?.original || data?.image?.preview || "");
  /* Shikimori отдаёт заглушку missing_original.jpg — считаем, что постера нет */
  if (!raw || /missing_/.test(raw)) return "";
  return absoluteShikimoriUrl(raw);
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
    malId: Number(data.myanimelist_id || data.mal_id) || 0,
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
