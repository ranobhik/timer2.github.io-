/* Импорт данных об аниме из внешних баз: Shikimori (рус.), AniList, Кинопоиск.
   Всё работает из браузера: сайты отдают CORS, поэтому прокси не нужен.
   Используется только в админке — публичные страницы не делают запросов к API. */

import { posterUrlById } from "./shikimori.js";

const SHIKI = "https://shikimori.one";
/* shikimori.one → 301 на shikimori.io, а у редиректа нет CORS-заголовков,
   поэтому в браузере запрос падал с NetworkError. Основной хост — .io. */
const SHIKI_API_HOSTS = ["https://shikimori.io/api", "https://shikimori.one/api"];
const ANILIST_API = "https://graphql.anilist.co";
const JIKAN_API = "https://api.jikan.moe/v4";
const KINOPOISK_API = "https://api.kinopoisk.dev/v1.4";

export const SOURCE_LABELS = {
  shikimori: "Shikimori",
  anilist: "AniList",
  kinopoisk: "Кинопоиск",
};

export const SHIKI_STATUS = {
  anons: "announced",
  ongoing: "ongoing",
  released: "released",
};

const ANIME_STATUS = {
  FINISHED: "released",
  RELEASING: "ongoing",
  NOT_YET_RELEASED: "announced",
  HIATUS: "hiatus",
  CANCELLED: "released",
};

const KIND_LABELS = {
  tv: "ТВ-сериал",
  movie: "Фильм",
  ova: "OVA",
  ona: "ONA",
  special: "Спешл",
  tv_special: "ТВ-спешл",
  music: "Клип",
};

/* ---------- HTTP ---------- */
async function request(url, { method = "GET", headers = {}, body, timeout = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { Accept: "application/json", ...headers },
      body,
    });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? " (нужен/проверьте токен)" : "";
      throw new Error(`HTTP ${res.status}${hint}`);
    }
    return await res.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Сервер не ответил вовремя");
    if (error instanceof TypeError) {
      throw new Error("Не удалось связаться с источником: проверьте VPN или блокировщик рекламы");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function absolute(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${SHIKI}${raw}`;
  return raw;
}

function stripHtml(value) {
  if (!value) return "";
  const holder = document.createElement("div");
  holder.innerHTML = String(value);
  holder.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  holder.querySelectorAll("p, div, li").forEach((block) => block.append("\n"));
  return (holder.textContent || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function yearOf(date) {
  const year = Number(String(date || "").slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : undefined;
}

/* ---------- Разбор запроса ---------- */
export function parseQuery(value) {
  const raw = String(value || "").trim();
  if (!raw) return { text: "" };
  if (/^\d+$/.test(raw)) return { id: raw };

  const shiki = raw.match(/shikimori\.(?:one|io)\/animes\/[a-z]*?(\d+)/i);
  if (shiki) return { id: shiki[1], source: "shikimori" };
  const anilist = raw.match(/anilist\.co\/anime\/(\d+)/i);
  if (anilist) return { id: anilist[1], source: "anilist" };
  const kp = raw.match(/kinopoisk\.ru\/(?:series|film)\/([a-z0-9]+)/i);
  if (kp) return { id: kp[1], source: "kinopoisk" };
  return { text: raw };
}

/* ======================================================================
   Shikimori
   ====================================================================== */
function shikimoriCandidate(item) {
  if (!item || !item.id) return null;
  return {
    source: "shikimori",
    sourceId: String(item.id),
    title: item.russian || item.name || "",
    originalTitle: item.name || "",
    year: yearOf(item.aired_on),
    score: Number(item.score) || 0,
    kind: KIND_LABELS[item.kind] || item.kind || "",
    poster: absolute(item.image?.original || item.image?.preview || "") || posterUrlById(item.id),
    episodes: Number(item.episodes) || Number(item.episodes_aired) || 0,
    status: SHIKI_STATUS[item.status] || "ongoing",
  };
}

export function mapShikimoriFull(data) {
  if (!data || !data.id) return null;
  const screenshots = Array.isArray(data.screenshots) ? data.screenshots : [];
  const genres = (data.genres || []).map((genre) => genre?.russian || genre?.name || "").filter(Boolean);
  const studios = (data.studios || []).map((studio) => studio?.name || "").filter(Boolean);
  const videos = Array.isArray(data.videos) ? data.videos : [];
  return {
    source: "shikimori",
    shikimoriId: String(data.id),
    malId: Number(data.myanimelist_id) || 0,
    title: data.russian || data.name || "",
    originalTitle: data.name || "",
    year: yearOf(data.aired_on || data.released_on),
    status: SHIKI_STATUS[data.status] || "ongoing",
    kind: KIND_LABELS[data.kind] || data.kind || "",
    genres,
    rating: Math.min(10, Math.max(0, Number(data.score) || 0)),
    ageRating: ageFromShikimori(data.rating),
    description: stripHtml(data.description_html) || String(data.description || "").trim(),
    poster: absolute(data.image?.original || data.image?.preview || "") || posterUrlById(data.id),
    banner: screenshots.length ? absolute(screenshots[0].original || screenshots[0].preview) : "",
    screenshots: screenshots.map((shot) => absolute(shot.original || shot.preview)).filter(Boolean),
    studio: studios[0] || "",
    director: "",
    country: "Япония",
    tags: [data.kind === "movie" ? "фильм" : "", KIND_LABELS[data.kind] || ""].filter(Boolean),
    episodesCount: Number(data.episodes) || Number(data.episodes_aired) || 0,
    duration: Number(data.duration) || 0,
    trailer: videos[0]?.player_url || "",
  };
}

function ageFromShikimori(rating) {
  const map = { g: "0+", pg: "6+", pg_13: "13+", r: "16+", r_plus: "18+", rx: "18+" };
  return map[String(rating || "").toLowerCase()] || "";
}

async function shikiRequest(path) {
  let lastError = null;
  for (const host of SHIKI_API_HOSTS) {
    try {
      return await request(`${host}${path}`);
    } catch (error) {
      lastError = error;
      if (/HTTP 4\d\d/.test(error?.message || "")) break;
    }
  }
  throw lastError;
}

export async function searchShikimori(query, limit = 8) {
  const list = await shikiRequest(`/animes?search=${encodeURIComponent(query)}&limit=${limit}&order=popularity`);
  return (Array.isArray(list) ? list : []).map(shikimoriCandidate).filter(Boolean);
}

export async function getShikimori(id) {
  const data = await shikiRequest(`/animes/${encodeURIComponent(String(id).trim())}`);
  return mapShikimoriFull(data);
}

/** Ищет тайтл по названию и возвращает первый полный результат. */
export async function findShikimori(query) {
  const list = await searchShikimori(query, 1);
  if (!list.length) return null;
  return getShikimori(list[0].sourceId);
}

/* ======================================================================
   AniList
   ====================================================================== */
const ANILIST_FIELDS = `
  id
  idMal
  title { romaji english native }
  bannerImage
  coverImage { extraLarge large }
  description(asHtml: false)
  genres
  averageScore
  episodes
  duration
  seasonYear
  format
  status
  studios(isMain: true) { edges { node { name } } }
`;

function anilistCandidate(media) {
  if (!media || !media.id) return null;
  return {
    source: "anilist",
    sourceId: String(media.id),
    anilistId: String(media.id),
    malId: media.idMal || 0,
    title: media.title?.english || media.title?.romaji || media.title?.native || "",
    originalTitle: media.title?.romaji || media.title?.native || "",
    year: media.seasonYear || undefined,
    score: media.averageScore ? media.averageScore / 10 : 0,
    kind: media.format ? media.format.replace(/_/g, " ").toLowerCase() : "",
    poster: media.coverImage?.extraLarge || media.coverImage?.large || "",
    episodes: media.episodes || 0,
    status: ANIME_STATUS[media.status] || "ongoing",
  };
}

export function mapAniListFull(media) {
  if (!media || !media.id) return null;
  return {
    source: "anilist",
    anilistId: String(media.id),
    malId: Number(media.idMal) || 0,
    shikimoriId: "",
    title: media.title?.english || media.title?.romaji || "",
    originalTitle: media.title?.romaji || media.title?.native || "",
    year: media.seasonYear || undefined,
    status: ANIME_STATUS[media.status] || "ongoing",
    kind: media.format || "",
    genres: Array.isArray(media.genres) ? media.genres.slice(0, 8) : [],
    rating: media.averageScore ? Math.round((media.averageScore / 10) * 10) / 10 : 0,
    ageRating: "",
    description: String(media.description || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim(),
    poster: media.coverImage?.extraLarge || media.coverImage?.large || "",
    banner: media.bannerImage || "",
    screenshots: media.bannerImage ? [media.bannerImage] : [],
    studio: media.studios?.edges?.[0]?.node?.name || "",
    director: "",
    country: "Япония",
    tags: [],
    episodesCount: Number(media.episodes) || 0,
    duration: Number(media.duration) || 0,
    trailer: "",
  };
}

export async function searchAniList(query, limit = 8) {
  const gql = `query ($search: String, $perPage: Int) {
    Page(perPage: $perPage) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${ANILIST_FIELDS} } }
  }`;
  const data = await request(ANILIST_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables: { search: query, perPage: limit } }),
  });
  return (data?.data?.Page?.media || []).map(anilistCandidate).filter(Boolean);
}

export async function getAniList(id) {
  const gql = `query ($id: Int) { Media(id: $id, type: ANIME) { ${ANILIST_FIELDS} } }`;
  const data = await request(ANILIST_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables: { id: Number(id) } }),
  });
  return mapAniListFull(data?.data?.Media);
}

/* ======================================================================
   Кинопоиск (kinopoisk.dev, нужен токен)
   ====================================================================== */
function kinopoiskCandidate(movie) {
  if (!movie || !movie.id) return null;
  return {
    source: "kinopoisk",
    sourceId: String(movie.id),
    title: movie.name || movie.alternativeName || movie.enName || "",
    originalTitle: movie.alternativeName || movie.enName || "",
    year: Number(movie.year) || undefined,
    score: Number(movie.rating?.kp) || 0,
    kind: movie.isSeries ? "Сериал" : "Фильм",
    poster: movie.poster?.url || movie.poster?.previewUrl || "",
    episodes: Number(movie.seriesLength) || 0,
    status: "released",
  };
}

export function mapKinopoiskFull(movie) {
  if (!movie || !movie.id) return null;
  const genres = (movie.genres || []).map((genre) => genre?.name || "").filter(Boolean);
  return {
    source: "kinopoisk",
    shikimoriId: "",
    kinopoiskId: String(movie.id),
    malId: 0,
    title: movie.name || movie.alternativeName || "",
    originalTitle: movie.alternativeName || movie.enName || "",
    year: Number(movie.year) || undefined,
    status: "released",
    kind: movie.isSeries ? "Сериал" : "Фильм",
    genres,
    rating: Math.round((Number(movie.rating?.kp) || 0) * 10) / 10,
    ageRating: movie.ageRating ? `${movie.ageRating}+` : "",
    description: String(movie.description || "").trim(),
    poster: movie.poster?.url || movie.poster?.previewUrl || "",
    banner: movie.backdrop?.url || "",
    screenshots: movie.backdrop?.url ? [movie.backdrop.url] : [],
    studio: "",
    director: "",
    country: (movie.countries || [])[0]?.name || "Япония",
    tags: [],
    episodesCount: Number(movie.seriesLength) || 0,
    duration: Number(movie.movieLength) || 0,
    trailer: "",
  };
}

async function kinopoiskRequest(path, token) {
  if (!token) throw new Error("Укажите токен Кинопоиска в настройках админки");
  return request(`${KINOPOISK_API}${path}`, { headers: { "X-API-KEY": token } });
}

export async function searchKinopoisk(query, token, limit = 8) {
  const data = await kinopoiskRequest(`/movie/search?page=1&limit=${limit}&query=${encodeURIComponent(query)}`, token);
  return (data?.docs || []).map(kinopoiskCandidate).filter(Boolean);
}

export async function getKinopoisk(id, token) {
  const data = await kinopoiskRequest(`/movie/${encodeURIComponent(id)}`, token);
  return mapKinopoiskFull(data);
}

/* ======================================================================
   Эпизоды (Jikan / MyAnimeList, по MAL ID)
   ====================================================================== */
export async function fetchEpisodes(malId, limit = 2) {
  if (!malId) return [];
  const episodes = [];
  for (let page = 1; page <= limit; page += 1) {
    const data = await request(`${JIKAN_API}/anime/${malId}/episodes?page=${page}`);
    (data?.data || []).forEach((ep) => {
      const number = Number(ep.mal_id) || episodes.length + 1;
      const title = String(ep.title || "").trim();
      episodes.push({
        number,
        title: title ? `Эпизод ${number}. ${title}` : "",
        date: String(ep.aired || "").slice(0, 10),
        duration: "",
      });
    });
    if (!data?.pagination?.has_next_page) break;
  }
  return episodes.slice(0, 120);
}

/* ======================================================================
   Сборка карточки для админки
   ====================================================================== */
export function candidateToAnime(candidate) {
  return {
    source: candidate.source,
    sourceId: candidate.sourceId,
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    year: candidate.year,
    status: candidate.status || "ongoing",
    genres: [],
    rating: candidate.score || 0,
    ageRating: "",
    description: "",
    poster: candidate.poster || "",
    banner: "",
    shikimoriId: candidate.source === "shikimori" ? candidate.sourceId : "",
    studio: "",
    director: "",
    country: "Япония",
    tags: [],
    episodesCount: candidate.episodes || 0,
    duration: 0,
    malId: candidate.malId || (candidate.source === "shikimori" ? Number(candidate.sourceId) : 0),
  };
}

/**
 * Полный импорт по кандидату: тянет данные из выбранного источника,
 * затем подстраивает русское название/постер через Shikimori и баннер через AniList.
 */
export async function importCandidate(candidate, { kinopoiskToken = "", withEpisodes = false } = {}) {
  let anime = null;
  if (candidate.source === "shikimori") {
    anime = await getShikimori(candidate.sourceId);
  } else if (candidate.source === "anilist") {
    anime = await getAniList(candidate.sourceId);
  } else if (candidate.source === "kinopoisk") {
    anime = await getKinopoisk(candidate.sourceId, kinopoiskToken);
  }
  if (!anime) throw new Error("Не удалось получить данные");
  return enrich(anime, { kinopoiskToken, withEpisodes, fallback: candidate });
}

/** Догружает недостающее: русские данные с Shikimori, широкий баннер с AniList, эпизоды. */
export async function enrich(anime, { withEpisodes = false, fallback = null } = {}) {
  const result = { ...anime };
  const fromShikimori = result.source === "shikimori";

  // 1. Русские данные: если источник не Shikimori — ищем тайтл там по ромадзи/английскому названию.
  if (!fromShikimori) {
    const query = result.originalTitle || result.title;
    if (query) {
      try {
        const found = await findShikimori(query);
        if (found) {
          result.shikimoriId = found.shikimoriId;
          result.malId = result.malId || found.malId;
          result.title = found.title || result.title;
          result.originalTitle = result.originalTitle || found.originalTitle;
          result.description = found.description || result.description;
          if (found.genres?.length) result.genres = found.genres;
          result.poster = found.poster || result.poster;
          result.banner = result.banner || found.banner;
          result.ageRating = result.ageRating || found.ageRating;
          result.studio = result.studio || found.studio;
          result.year = result.year || found.year;
        }
      } catch (error) {
        console.debug("Shikimori enrich:", error?.message);
      }
    }
  }

  // 2. Широкий баннер: AniList отдаёт готовые 16:9 баннеры под шапку.
  if (!result.banner) {
    try {
      const list = await searchAniList(result.originalTitle || result.title, 1);
      if (list.length) {
        const full = await getAniList(list[0].sourceId);
        if (full?.banner) result.banner = full.banner;
        if (!result.malId && full?.malId) result.malId = full.malId;
        if (!result.poster && full?.poster) result.poster = full.poster;
      }
    } catch (error) {
      console.debug("AniList enrich:", error?.message);
    }
  }

  // 3. Постер по Shikimori ID доступен всегда, даже если API молчит.
  if (!result.poster && result.shikimoriId) result.poster = posterUrlById(result.shikimoriId);
  if (!result.poster && fallback?.poster) result.poster = fallback.poster;

  // 4. Эпизоды с настоящими названиями (Jikan / MyAnimeList).
  if (withEpisodes && result.malId) {
    try {
      result.episodeList = await fetchEpisodes(result.malId);
    } catch (error) {
      console.debug("Jikan:", error?.message);
    }
  }

  if (!result.episodesCount && result.episodeList?.length) result.episodesCount = result.episodeList.length;
  return result;
}

export { stripHtml, KIND_LABELS };
