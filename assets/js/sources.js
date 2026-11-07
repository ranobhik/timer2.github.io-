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
const KITSU_API = "https://kitsu.io/api/edge";
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

/* ---------- Кеш ответов API ----------
   Повторный импорт того же тайтла (и повторный поиск) отдаётся из localStorage
   за миллисекунды, без сети. */
const API_CACHE_KEY = "rp.api-cache.v1";
const API_CACHE_TTL = 1000 * 60 * 60 * 12;
const API_CACHE_LIMIT = 90;
const API_CACHE_MAX_BYTES = 150000;

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readApiCache() {
  const store = storage();
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(API_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeApiCache(cache) {
  const store = storage();
  if (!store) return;
  const keys = Object.keys(cache);
  if (keys.length > API_CACHE_LIMIT) {
    keys.sort((a, b) => (cache[a]?.at || 0) - (cache[b]?.at || 0));
    keys.slice(0, keys.length - API_CACHE_LIMIT).forEach((key) => delete cache[key]);
  }
  try {
    store.setItem(API_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* нет места — просто не кешируем */
  }
}

function cacheKey(url, body) {
  return `${url}${body ? `|${String(body).slice(0, 160)}` : ""}`;
}

function cacheRead(key) {
  const entry = readApiCache()[key];
  if (!entry || !entry.at) return null;
  if (Date.now() - entry.at > API_CACHE_TTL) return null;
  return entry.data ?? null;
}

function cacheWrite(key, data) {
  let serialized;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return;
  }
  if (!serialized || serialized.length > API_CACHE_MAX_BYTES) return;
  const cache = readApiCache();
  cache[key] = { at: Date.now(), data };
  writeApiCache(cache);
}

/* ---------- HTTP ---------- */
async function request(url, { method = "GET", headers = {}, body, timeout = 8000, cache = true } = {}) {
  const key = cache ? cacheKey(url, body) : "";
  if (key) {
    const cached = cacheRead(key);
    if (cached) return cached;
  }
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
    const data = await res.json();
    if (key) cacheWrite(key, data);
    return data;
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

/** Shikimori отдаёт заглушку missing_original.jpg, если постера нет — считаем, что его нет. */
function pickShikiImage(image) {
  const original = image?.original || image?.preview || "";
  if (!original || /missing_(original|preview)/i.test(original)) return "";
  return absolute(original);
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

/** В поле description у Shikimori остаются служебные метки вида [character=123]…[/character]. */
function cleanShikiText(value) {
  return String(value || "")
    .replace(/\[(?:character|person|anime|manga|url|spoiler)[^\]]*\]/gi, "")
    .replace(/\[\/(?:character|person|anime|manga|url|spoiler)\]/gi, "")
    .replace(/\[\/?\w+\]/g, "")
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
    poster: pickShikiImage(item.image),
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
    description: stripHtml(data.description_html) || cleanShikiText(data.description),
    poster: pickShikiImage(data.image),
    banner: screenshots.length ? pickShikiImage(screenshots[0]) : "",
    screenshots: screenshots.map(pickShikiImage).filter(Boolean),
    studio: studios[0] || "",
    director: "",
    country: "Япония",
    tags: [data.kind === "movie" ? "фильм" : "", KIND_LABELS[data.kind] || ""].filter(Boolean),
    aliases: [
      ...(Array.isArray(data.english) ? data.english : []),
      ...(Array.isArray(data.synonyms) ? data.synonyms : []),
      ...(Array.isArray(data.japanese) ? data.japanese : []),
    ].filter(Boolean),
    episodesCount: Math.max(Number(data.episodes) || 0, Number(data.episodes_aired) || 0),
    episodesAired: Number(data.episodes_aired) || 0,
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
    aliases: [media.title?.english, media.title?.romaji, media.title?.native].filter(Boolean),
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
    aliases: [movie.alternativeName, movie.enName].filter(Boolean),
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
   Жанры: AniList и Jikan отдают английские названия — приводим к русским
   ====================================================================== */
const GENRE_RU = {
  action: "Экшен",
  adventure: "Приключения",
  "avant garde": "Авангард",
  "award winning": "Награды",
  comedy: "Комедия",
  drama: "Драма",
  fantasy: "Фэнтези",
  horror: "Ужасы",
  mystery: "Мистика",
  romance: "Романтика",
  "sci fi": "Фантастика",
  "science fiction": "Фантастика",
  "slice of life": "Повседневность",
  sports: "Спорт",
  supernatural: "Сверхъестественное",
  thriller: "Триллер",
  music: "Музыка",
  mecha: "Меха",
  psychological: "Психологическое",
  ecchi: "Этти",
  "boys love": "Сёнэн-ай",
  "girls love": "Сёдзё-ай",
  shounen: "Сёнен",
  shonen: "Сёнен",
  shoujo: "Сёдзё",
  shojo: "Сёдзё",
  seinen: "Сэйнэн",
  josei: "Дзёсэй",
  kodomo: "Кодомо",
  harem: "Гарем",
  isekai: "Исекай",
  military: "Военное",
  historical: "Историческое",
  demons: "Демоны",
  magic: "Магия",
  space: "Космос",
  vampire: "Вампиры",
  game: "Игры",
  parody: "Пародия",
  samurai: "Самураи",
  detective: "Детектив",
  "martial arts": "Боевые искусства",
  school: "Школа",
  "super power": "Суперсила",
  "time travel": "Путешествие во времени",
  "post apocalyptic": "Постапокалипсис",
  "sci fi fantasy": "Фантастика",
  gourmet: "Гурман",
  "love polygon": "Любовный треугольник",
  "adult cast": "Взрослые герои",
  "performing arts": "Искусство",
  "video game": "Игры",
  "crossdressing": "Переодевание",
  "high stakes game": "Игра на выживание",
  "survival": "Выживание",
  "gore": "Жестокость",
  "suspense": "Саспенс",
  "iyashikei": "Ияшикэй",
  "reincarnation": "Реинкарнация",
  "delinquents": "Хулиганы",
  "workplace": "Работа",
  "idol": "Идолы",
};

function genreKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-zа-яё0-9]+/g, " ").trim();
}

/** Русское название жанра: Shikimori уже отдаёт русские, AniList/Jikan — английские. */
export function genreToRu(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  if (/[а-яё]/i.test(raw)) return raw;
  return GENRE_RU[genreKey(raw)] || "";
}

export function mergeGenres(...lists) {
  const out = [];
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((genre) => {
      const ru = genreToRu(genre);
      if (ru && !out.includes(ru)) out.push(ru);
    });
  });
  return out.slice(0, 10);
}

/* ======================================================================
   AniList по MyAnimeList ID — точная связка без поиска по названию
   ====================================================================== */
export async function getAniListByMal(malId) {
  const id = Number(malId);
  if (!id) return null;
  const gql = `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { ${ANILIST_FIELDS} } }`;
  const data = await request(ANILIST_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables: { idMal: id } }),
  });
  return mapAniListFull(data?.data?.Media);
}

/* ======================================================================
   Jikan (MyAnimeList): жанры, синопсис, число серий
   ====================================================================== */
function parseDuration(value) {
  const match = String(value || "").match(/(\d+)\s*(?:min|мин)/i);
  return match ? Number(match[1]) : 0;
}

export async function getJikanAnime(malId) {
  const id = Number(malId);
  if (!id) return null;
  const data = await request(`${JIKAN_API}/anime/${id}`, { timeout: 7000 });
  const d = data?.data;
  if (!d) return null;
  return {
    source: "jikan",
    malId: id,
    title: d.title_english || d.title || "",
    originalTitle: d.title_japanese || d.title || "",
    description: String(d.synopsis || "").trim(),
    genres: [...(d.genres || []), ...(d.themes || []), ...(d.demographics || [])]
      .map((genre) => genre?.name || "")
      .filter(Boolean),
    poster: d.images?.jpg?.large_image_url || d.images?.webp?.large_image_url || d.images?.jpg?.image_url || "",
    episodesCount: Number(d.episodes) || 0,
    duration: parseDuration(d.duration),
    year: Number(d.year) || Number(d.aired?.prop?.from?.year) || undefined,
    rating: Number(d.score) || 0,
    studio: (d.studios || [])[0]?.name || "",
    ageRating: d.rating ? String(d.rating).replace(/^.*?-\s*/, "") : "",
  };
}

/* ======================================================================
   Эпизоды (Jikan / MyAnimeList, по MAL ID)
   ====================================================================== */
/** Ищет MAL ID по названию — нужен, когда Shikimori/AniList ещё не связали тайтл с MAL. */
export async function resolveMalId(title, year = 0) {
  const query = String(title || "").trim();
  if (!query) return 0;
  const data = await request(`${JIKAN_API}/anime?q=${encodeURIComponent(query)}&limit=5&sfw`, { timeout: 7000 });
  const list = data?.data || [];
  if (!list.length) return 0;
  const wanted = Number(year) || 0;
  const pick = list.find((item) => !wanted || !item.year || Math.abs(Number(item.year) - wanted) <= 1) || list[0];
  return Number(pick?.mal_id) || 0;
}

export async function fetchEpisodes(malId, limit = 3) {
  if (!malId) return [];
  const episodes = [];
  for (let page = 1; page <= limit; page += 1) {
    const data = await request(`${JIKAN_API}/anime/${malId}/episodes?page=${page}`, { timeout: 7000 });
    (data?.data || []).forEach((ep) => {
      const number = Number(ep.mal_id) || episodes.length + 1;
      const title = String(ep.title || "").trim();
      const meaningful = /^(episode|эпизод|серия)?\s*\d*$/i.test(title) ? "" : title;
      episodes.push({
        number,
        title: meaningful,
        date: String(ep.aired || "").slice(0, 10),
        duration: "",
      });
    });
    if (!data?.pagination?.has_next_page) break;
  }
  return episodes.slice(0, 200);
}

/* ======================================================================
   Kitsu — запасной источник названий серий, если Jikan недоступен
   ====================================================================== */
function kitsuTitles(attributes) {
  const titles = attributes?.titles || {};
  return [attributes?.canonicalTitle, ...Object.values(titles)].filter(Boolean);
}

export async function fetchKitsuEpisodes(queries = []) {
  for (const query of queries) {
    const search = await attempt(() => request(
      `${KITSU_API}/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=5`,
      { timeout: 7000 },
    ));
    const list = search?.data || [];
    const hit = list.find((item) => kitsuTitles(item.attributes).some((title) => titleLike(query, title))
      || kitsuTitles(item.attributes).some((title) => expectedTitlesMatch(title, queries)));
    if (!hit) continue;

    const episodes = [];
    for (let offset = 0; offset < 80; offset += 20) {
      const page = await attempt(() => request(
        `${KITSU_API}/anime/${hit.id}/episodes?page[limit]=20&page[offset]=${offset}`,
        { timeout: 7000 },
      ));
      const rows = page?.data || [];
      rows.forEach((row) => {
        const attributes = row.attributes || {};
        const number = Number(attributes.number) || episodes.length + 1;
        episodes.push({
          number,
          title: String(attributes.canonicalTitle || "").trim(),
          date: String(attributes.airdate || "").slice(0, 10),
          duration: attributes.length ? String(attributes.length) : "",
        });
      });
      if (rows.length < 20) break;
    }
    if (episodes.length) return episodes;
  }
  return [];
}

function expectedTitlesMatch(title, queries) {
  return queries.some((query) => titleLike(query, title));
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

async function attempt(factory) {
  try {
    return await factory();
  } catch (error) {
    console.debug("Импорт:", error?.message);
    return null;
  }
}

const hasCyrillic = (value) => /[а-яё]/i.test(String(value || ""));

/** Мягкое сравнение названий: «Shuiro no Kamen» ≈ «shuiro no kamen». */
function titleLike(a, b) {
  const key = (value) => genreKey(value).replace(/\s+/g, "");
  const x = key(a);
  const y = key(b);
  if (!x || !y || x.length < 4 || y.length < 4) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const wordsA = genreKey(a).split(" ").filter((w) => w.length > 3);
  const wordsB = genreKey(b).split(" ").filter((w) => w.length > 3);
  return wordsA.some((word) => wordsB.includes(word));
}

/** Ищет тайтл на Shikimori по списку названий, проверяя, что это действительно он. */
async function findShikimoriByTitles(queries, expected) {
  for (const query of queries) {
    const list = await attempt(() => searchShikimori(query, 6));
    if (!list?.length) continue;
    const hit = list.find((item) => (
      expected.some((name) => titleLike(name, item.title))
      || expected.some((name) => titleLike(name, item.originalTitle))
      || titleLike(query, item.title)
    )) || null;
    if (!hit) continue;
    const full = await attempt(() => getShikimori(hit.sourceId));
    if (full) return full;
  }
  return null;
}

/**
 * Полный импорт по кандидату: тянет данные из источника, затем добирает
 * недостающее из Shikimori, AniList и Jikan (MyAnimeList) и склеивает всё в одну карточку.
 */
export async function importBase(candidate, { kinopoiskToken = "" } = {}) {
  if (!candidate) return null;
  if (candidate.source === "shikimori") return getShikimori(candidate.sourceId);
  if (candidate.source === "anilist") return getAniList(candidate.sourceId);
  if (candidate.source === "kinopoisk") return getKinopoisk(candidate.sourceId, kinopoiskToken);
  return null;
}

export async function importCandidate(candidate, { kinopoiskToken = "", withEpisodes = true } = {}) {
  const anime = await importBase(candidate, { kinopoiskToken });
  if (!anime) throw new Error("Не удалось получить данные");
  return enrich(anime, { kinopoiskToken, withEpisodes, fallback: candidate });
}

/**
 * Склеивает данные из нескольких баз: где чего-то нет — берём из другой.
 * Русский текст приоритетнее, постер и баннер подставляются из первого источника,
 * где они реально есть.
 */
export async function enrich(anime, { kinopoiskToken = "", withEpisodes = true, fallback = null } = {}) {
  const result = { ...anime };
  const report = { sources: [], description: "", genres: 0, poster: "", episodes: 0, titles: 0 };

  const queries = [...new Set([
    result.originalTitle, result.title, fallback?.originalTitle, fallback?.title,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const expected = [...new Set([result.title, result.originalTitle, fallback?.title, fallback?.originalTitle]
    .map((value) => String(value || "").trim()).filter(Boolean))];

  /* Запросы идут параллельно: импорт занимает столько времени, сколько нужно самому
     медленному источнику, а не сумме всех. */
  const upfrontMal = Number(result.malId) || 0;
  const hasAllCore = Boolean(result.poster && (result.genres || []).length && result.description);

  /* 1. Shikimori — русские названия, описание, жанры, постер. */
  const shikiTask = result.source === "shikimori"
    ? Promise.resolve(result)
    : (async () => {
      if (result.shikimoriId) {
        const byId = await attempt(() => getShikimori(result.shikimoriId));
        if (byId) return byId;
      }
      return findShikimoriByTitles(queries, expected);
    })();

  /* 2. AniList — баннеры 16:9, постеры, жанры, MAL ID. Если всё уже есть — не тратим время. */
  const needAniList = !hasAllCore || !upfrontMal;
  const anilistTask = result.source === "anilist"
    ? Promise.resolve(result)
    : (needAniList ? (async () => {
      if (upfrontMal) {
        const byMal = await attempt(() => getAniListByMal(upfrontMal));
        if (byMal) return byMal;
      }
      for (const query of queries) {
        const list = await attempt(() => searchAniList(query, 1));
        if (!list?.length) continue;
        const full = await attempt(() => getAniList(list[0].sourceId));
        if (full) return full;
      }
      return null;
    })() : Promise.resolve(null));

  /* 3. Jikan (MyAnimeList) — жанры, синопсис, названия серий. */
  const jikanTask = upfrontMal ? attempt(() => getJikanAnime(upfrontMal)) : Promise.resolve(null);
  const episodesTask = (withEpisodes && upfrontMal) ? attempt(() => fetchEpisodes(upfrontMal)) : Promise.resolve(null);

  const [shiki, anilist, jikanEarly, episodesEarly] = await Promise.all([
    shikiTask, anilistTask, jikanTask, episodesTask,
  ]);
  if (shiki?.shikimoriId) report.sources.push("Shikimori");
  if (anilist?.anilistId) report.sources.push("AniList");

  let malId = upfrontMal || Number(result.malId) || Number(shiki?.malId) || Number(anilist?.malId) || 0;

  /* У свежих тайтлов Shikimori ещё не знает MAL ID — ищем его по названию,
     иначе не подтянутся названия и даты серий. */
  if (!malId) {
    const guessed = await attempt(() => resolveMalId(result.originalTitle || result.title, result.year));
    malId = Number(guessed) || 0;
    if (malId) report.sources.push("MyAnimeList");
  }

  /* MAL ID мог появиться только после ответа Shikimori/AniList — тогда дозапрашиваем
     Jikan и серии (снова параллельно). */
  let jikan = jikanEarly;
  let episodeList = episodesEarly || [];
  if (malId && (!jikan || (withEpisodes && !episodeList.length))) {
    const [lateJikan, lateEpisodes] = await Promise.all([
      jikan ? Promise.resolve(jikan) : attempt(() => getJikanAnime(malId)),
      (withEpisodes && !episodeList.length) ? attempt(() => fetchEpisodes(malId)) : Promise.resolve(null),
    ]);
    jikan = lateJikan || jikan;
    episodeList = lateEpisodes?.length ? lateEpisodes : episodeList;
  }

  // MAL ID мог прийти из Shikimori и указывать на другой тайтл — сверяем названия.
  if (jikan) {
    const known = [...expected, anilist?.title, anilist?.originalTitle].filter(Boolean);
    const named = Boolean(jikan.title || jikan.originalTitle);
    const matches = !named || !known.length || known.some((name) => titleLike(name, jikan.title)
      || titleLike(name, jikan.originalTitle));
    if (!matches && shiki) {
      console.debug("Jikan: MAL ID не совпал по названию", jikan.title);
      jikan = null;
    }
  }
  if (jikan) report.sources.push("MyAnimeList");

  /* 4. Названия серий: если Jikan недоступен (частая блокировка) — берём с Kitsu. */
  if (withEpisodes && !episodeList.length) {
    const kitsu = (await attempt(() => fetchKitsuEpisodes(queries))) || [];
    if (kitsu.length) {
      episodeList = kitsu;
      report.sources.push("Kitsu");
    }
  }

  /* ---------- Названия ---------- */
  const ruTitle = [result.title, shiki?.title].find((value) => value && hasCyrillic(value) && value.trim())
    || result.title || shiki?.title || anilist?.title || jikan?.title || "Без названия";
  const previousTitle = result.title;
  result.title = ruTitle;
  if (!result.originalTitle || result.originalTitle === previousTitle || hasCyrillic(result.originalTitle)) {
    const latin = [shiki?.originalTitle, anilist?.originalTitle, jikan?.originalTitle, result.originalTitle]
      .find((value) => value && !hasCyrillic(value));
    if (latin) result.originalTitle = latin;
  }
  report.titles = result.originalTitle ? 2 : 1;

  /* ---------- Описание: сначала русское ---------- */
  const descriptions = [
    [result.description, "источник"],
    [shiki?.description, "Shikimori"],
    [jikan?.description, "MyAnimeList"],
    [anilist?.description, "AniList"],
  ].filter(([text]) => text && String(text).trim().length > 20);
  const ruDescription = descriptions.find(([text]) => hasCyrillic(text));
  const chosenDescription = ruDescription || descriptions[0];
  if (chosenDescription) {
    result.description = String(chosenDescription[0]).trim();
    report.description = chosenDescription[1];
  } else if (!result.description) {
    result.description = String(shiki?.description || jikan?.description || anilist?.description || "").trim();
  }

  /* ---------- Жанры ---------- */
  result.genres = mergeGenres(shiki?.genres, result.genres, anilist?.genres, jikan?.genres);
  report.genres = result.genres.length;

  /* ---------- Постер и баннер ---------- */
  const posters = [
    [result.poster, "источник"],
    [shiki?.poster, "Shikimori"],
    [anilist?.poster, "AniList"],
    [jikan?.poster, "MyAnimeList"],
  ].filter(([url]) => url);
  const chosenPoster = posters[0];
  result.poster = chosenPoster ? chosenPoster[0] : (result.shikimoriId ? posterUrlById(result.shikimoriId) : "");
  report.poster = chosenPoster ? chosenPoster[1] : (result.poster ? "Shikimori по ID" : "");

  result.banner = result.banner || anilist?.banner || shiki?.banner
    || (Array.isArray(shiki?.screenshots) ? shiki.screenshots[0] : "") || "";
  if (!result.screenshots?.length && shiki?.screenshots?.length) result.screenshots = shiki.screenshots;

  /* ---------- Остальные поля ---------- */
  result.year = Number(result.year) || Number(shiki?.year) || Number(anilist?.year) || Number(jikan?.year) || undefined;
  result.rating = Number(result.rating) || Number(shiki?.rating) || Number(anilist?.rating) || Number(jikan?.rating) || 0;
  result.ageRating = result.ageRating || jikan?.ageRating || shiki?.ageRating || "";
  result.studio = result.studio || shiki?.studio || anilist?.studio || jikan?.studio || "";
  result.country = result.country || "Япония";
  result.duration = Number(result.duration) || Number(shiki?.duration) || Number(anilist?.duration)
    || Number(jikan?.duration) || 0;
  result.status = result.status || shiki?.status || anilist?.status || "ongoing";
  result.tags = [...new Set([...(result.tags || []), ...(shiki?.tags || [])].filter(Boolean))];
  result.aliases = [...new Set([
    ...(result.aliases || []), ...(shiki?.aliases || []), ...(anilist?.aliases || []),
  ].filter(Boolean))].slice(0, 14);
  result.shikimoriId = result.shikimoriId || shiki?.shikimoriId || "";
  result.anilistId = result.anilistId || anilist?.anilistId || "";
  result.malId = malId || Number(jikan?.malId) || 0;
  if (Array.isArray(anilist?.screenshots) && !result.screenshots?.length) result.screenshots = anilist.screenshots;

  /* ---------- Эпизоды ---------- */
  const counts = [
    Number(result.episodesCount), Number(shiki?.episodesCount), Number(anilist?.episodesCount),
    Number(jikan?.episodesCount), episodeList.length,
  ].filter((count) => count > 0);
  result.episodesCount = counts.length ? Math.max(...counts) : 0;
  if (episodeList.length) {
    result.episodeList = episodeList
      .map((ep, index) => ({ ...ep, number: Number(ep.number) || index + 1 }))
      .sort((a, b) => a.number - b.number);
  }
  report.episodes = result.episodesCount;

  result.report = report;
  return result;
}

/* ======================================================================
   Перевод названий серий на русский (Google → MyMemory, с кешем)
   ====================================================================== */
const TRANSLATE_CACHE_KEY = "rp.translate.v1";

function readTranslations() {
  const store = storage();
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(TRANSLATE_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function rememberTranslation(source, translated) {
  const store = storage();
  if (!store) return;
  const map = readTranslations();
  map[source] = translated;
  const keys = Object.keys(map);
  if (keys.length > 800) keys.slice(0, keys.length - 800).forEach((key) => delete map[key]);
  try {
    store.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* нет места — не кешируем */
  }
}

async function translateOne(text) {
  const cached = readTranslations()[text];
  if (cached) return cached;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const translated = Array.isArray(data?.[0]) ? data[0].map((part) => part?.[0] || "").join("").trim() : "";
      if (translated) {
        rememberTranslation(text, translated);
        return translated;
      }
    }
  } catch (error) {
    console.debug("Перевод (Google):", error?.message);
  }
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ru`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const translated = String(data?.responseData?.translatedText || "").trim();
      if (translated && !/MYMEMORY WARNING/i.test(translated)) {
        rememberTranslation(text, translated);
        return translated;
      }
    }
  } catch (error) {
    console.debug("Перевод (MyMemory):", error?.message);
  }
  return "";
}

/** Переводит набор названий на русский. Возвращает карту «оригинал → перевод». */
export async function translateTitles(titles, { limit = 60 } = {}) {
  const unique = [...new Set((titles || []).map((title) => String(title || "").trim()).filter(Boolean))]
    .filter((title) => !/^[а-яё\s\d.,:!?—–-]+$/i.test(title))
    .slice(0, limit);
  const map = {};
  for (const title of unique) {
    const translated = await translateOne(title);
    if (translated) map[title] = translated;
  }
  return map;
}

/* ======================================================================
   Kodik — плееры озвучек, в том числе «Рабочей партии»
   Требуется токен партнёра kodikapi.com (вводится в настройках админки).
   ====================================================================== */
const KODIK_API = "https://kodik-api.com";

function proxied(url, proxy) {
  return proxy ? `${proxy}${encodeURIComponent(url)}` : url;
}

/* Публичные CORS-прокси: запросы идут параллельно, побеждает первый ответивший. */
const PUBLIC_PROXIES = [
  "https://api.allorigins.win/raw?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://api.cors.lol/?url=",
  "https://corsproxy.io/?url=",
  "https://cors.eu.org/",
  "https://test.cors.workers.dev/?",
];

/** Короткая понятная причина, если не ответил ни один путь. */
function pickError(errors) {
  const list = errors.filter(Boolean);
  const auth = list.find((item) => /HTTP (401|403)/.test(item));
  if (auth) return auth;
  const http = list.find((item) => /HTTP \d{3}/.test(item));
  if (http) return http;
  return list[0] || "источник недоступен";
}

/**
 * Гонка «напрямую + прокси»: все варианты стартуют одновременно,
 * возвращается первый успешный ответ. Так ожидание не суммируется.
 */
async function raceRequest(url, { proxy = "", timeout = 15000, hedge = 2500 } = {}) {
  const candidates = proxy ? [proxy] : PUBLIC_PROXIES;
  const targets = [
    { label: "напрямую", url },
    ...candidates.map((item, index) => ({ label: proxy ? "через свой прокси" : `через прокси №${index + 1}`, url: proxied(url, item) })),
  ];
  return new Promise((resolve, reject) => {
    const errors = [];
    let finished = false;
    let started = 0;
    let pending = 0;
    let proxiesStarted = false;

    const fire = (target) => {
      started += 1;
      pending += 1;
      request(target.url, { timeout, cache: false })
        .then((data) => {
          if (finished) return;
          finished = true;
          resolve(data);
        })
        .catch((error) => {
          pending -= 1;
          errors.push(`${target.label}: ${error?.message || "ошибка"}`);
          /* прямой путь закрыт — прокси пробуем сразу, не дожидаясь hedge */
          if (target === targets[0] && !proxiesStarted) startProxies();
          if (pending === 0 && started === targets.length && !finished) {
            finished = true;
            reject(new Error(pickError(errors)));
          }
        });
    };

    const startProxies = () => {
      if (proxiesStarted || finished) return;
      proxiesStarted = true;
      targets.slice(1).forEach(fire);
    };

    fire(targets[0]);
    setTimeout(() => { if (!finished) startProxies(); }, hedge);
  });
}

/** Проверка всех путей до Kodik — для кнопки «Проверить ключи». */
export async function probeKodik({ token, proxy = "", timeout = 12000 } = {}) {
  const url = `${KODIK_API}/translations?${new URLSearchParams({ token, limit: "1" }).toString()}`;
  const candidates = proxy
    ? [{ label: "свой прокси", url: proxied(url, proxy) }]
    : PUBLIC_PROXIES.map((item, index) => ({ label: `прокси №${index + 1}`, url: proxied(url, item) }));
  const targets = [{ label: "напрямую", url }, ...candidates];
  return Promise.all(targets.map(async (target) => {
    const started = Date.now();
    try {
      const data = await request(target.url, { timeout, cache: false });
      return { label: target.label, ok: true, ms: Date.now() - started, detail: `озвучек ${(data?.results || []).length}` };
    } catch (error) {
      return { label: target.label, ok: false, ms: Date.now() - started, detail: error?.message || "ошибка" };
    }
  }));
}

/** Проверка всех путей до CVH — для кнопки «Проверить ключи». */
export async function probeCvh({ id = "51019", pub = "747", aggr = "mali", proxy = "", timeout = 10000 } = {}) {
  const url = `${CVH_API}/playlist?pub=${encodeURIComponent(pub)}&aggr=${encodeURIComponent(aggr)}&id=${encodeURIComponent(id)}`;
  const candidates = proxy
    ? [{ label: "свой прокси", url: proxied(url, proxy) }]
    : PUBLIC_PROXIES.map((item, index) => ({ label: `прокси №${index + 1}`, url: proxied(url, item) }));
  const targets = [{ label: "напрямую", url }, ...candidates];
  return Promise.all(targets.map(async (target) => {
    const started = Date.now();
    try {
      const data = await request(target.url, { timeout, cache: false });
      const count = Array.isArray(data?.items) ? data.items.length : 0;
      return { label: target.label, ok: count > 0, ms: Date.now() - started, detail: `серий ${count}` };
    } catch (error) {
      return { label: target.label, ok: false, ms: Date.now() - started, detail: error?.message || "ошибка" };
    }
  }));
}

async function kodikRequest(path, params, { proxy = "", timeout = 15000 } = {}) {
  const direct = `${KODIK_API}${path}?${new URLSearchParams(params).toString()}`;
  return raceRequest(direct, { proxy, timeout });
}

/* В марте 2026 Kodik сменил домены: kodikapi.com/kodik.info больше не работают.
   API — kodik-api.com, плеер — kodikplayer.com. Старые ссылки переписываем на лету. */
const KODIK_PLAYER = "https://kodikplayer.com";
const KODIK_OLD_HOSTS = /^(?:https?:)?\/\/(?:www\.)?(?:kodik\.info|kodik\.biz|kodik\.cc|kodik\.ws|kodik\.me)\//i;

export function modernizeKodikUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(KODIK_OLD_HOSTS, `${KODIK_PLAYER}/`);
}

function kodikLink(link) {
  const raw = modernizeKodikUrl(link);
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${KODIK_PLAYER}${raw}`;
  return raw;
}

/** Разбирает сезоны/серии ответа Kodik в плоский список серий. */
export function kodikEpisodes(item) {
  const seasons = item?.seasons || {};
  const list = [];
  Object.keys(seasons).forEach((seasonKey) => {
    const season = seasons[seasonKey] || {};
    const episodes = season.episodes || {};
    Object.keys(episodes).forEach((episodeKey) => {
      const raw = episodes[episodeKey];
      /* новый API отдаёт серии просто строкой со ссылкой, старый — объектом { link } */
      const link = kodikLink(typeof raw === "string" ? raw : raw?.link);
      if (!link) return;
      list.push({
        season: Number(seasonKey) || 1,
        number: Number(episodeKey) || list.length + 1,
        link,
        screenshots: (raw && typeof raw === "object" && Array.isArray(raw.screenshots)) ? raw.screenshots : [],
      });
    });
  });
  if (!list.length && item?.link) {
    list.push({ season: 1, number: 1, link: kodikLink(item.link), screenshots: item.screenshots || [] });
  }
  return list.sort((a, b) => a.season - b.season || a.number - b.number);
}

function normalizeKodik(results) {
  return (Array.isArray(results) ? results : []).map((item) => ({
    id: item?.id || "",
    type: item?.type || "",
    link: kodikLink(item?.link),
    title: String(item?.title || "").trim(),
    originalTitle: String(item?.title_orig || "").trim(),
    otherTitle: String(item?.other_title || "").trim(),
    year: Number(item?.year) || undefined,
    translation: {
      id: item?.translation?.id || 0,
      title: String(item?.translation?.title || "").trim(),
      type: String(item?.translation?.type || "").trim(),
    },
    episodesCount: Number(item?.episodes_count) || Number(item?.last_episode) || 0,
    shikimoriId: String(item?.shikimori_id || ""),
    quality: String(item?.quality || ""),
    screenshots: Array.isArray(item?.screenshots) ? item.screenshots : [],
    episodes: kodikEpisodes(item),
  })).filter((item) => item.episodes.length || item.link);
}

export async function kodikTranslations({ token, proxy = "", timeout = 20000 } = {}) {
  if (!token) throw new Error("Укажите токен Kodik в «Настройках сайта»");
  const data = await kodikRequest("/translations", { token }, { proxy, timeout });
  return (data?.results || [])
    .map((item) => ({
      id: Number(item?.id) || 0,
      title: String(item?.title || "").trim(),
      type: String(item?.type || "").trim(),
    }))
    .filter((item) => item.id && item.title);
}

/** Ищет плееры по Shikimori ID или названию. */
export async function kodikSearch({ token, shikimoriId = "", title = "", translationId = "", proxy = "", limit = 100, timeout = 15000 } = {}) {
  if (!token) throw new Error("Укажите токен Kodik в «Настройках сайта»");
  const params = { token, limit: String(limit), with_episodes: "true" };
  if (shikimoriId) params.shikimori_id = String(shikimoriId);
  else if (title) params.title = title;
  else throw new Error("Нужен Shikimori ID или название");
  if (translationId) params.translation_id = String(translationId);
  const data = await kodikRequest("/search", params, { proxy, timeout });
  return normalizeKodik(data?.results);
}

/** Список всех тайтлов выбранной озвучки — для синхронизации каталога. */
export async function kodikList({ token, translationId = "", proxy = "", types = "anime-serial,anime", maxPages = 5 } = {}) {
  if (!token) throw new Error("Укажите токен Kodik в «Настройках сайта»");
  const collected = [];
  let url = `${KODIK_API}/list?${new URLSearchParams({
    token,
    limit: "100",
    types,
    with_episodes: "true",
    ...(translationId ? { translation_id: String(translationId) } : {}),
  }).toString()}`;

  for (let page = 0; page < maxPages && url; page += 1) {
    const data = await raceRequest(url, { proxy, timeout: 20000 });
    collected.push(...normalizeKodik(data?.results));
    const next = String(data?.next_page || "");
    url = next ? (next.startsWith("http") ? next : `${KODIK_API}${next.startsWith("/") ? "" : "/"}${next}`) : "";
  }
  return collected;
}

/* =======================================================================
   CVH (CDNVideoHub) — плеер, который использует Shikimori и партнёрские сайты
   Открытый API: /playlist отдаёт все серии и озвучки тайтла,
   /video/<vkId> — ссылки на поток конкретной серии.
   ======================================================================= */
const CVH_API = "https://plapi.cdnvideohub.com/api/v1/player/sv";

async function cvhRequest(url, proxy = "", timeout = 16000) {
  return raceRequest(url, { proxy, timeout });
}

/** Все серии и озвучки тайтла CVH по его числовому ID. */
export async function cvhPlaylist({ id, pub = "747", aggr = "mali", proxy = "" } = {}) {
  const clean = String(id || "").trim();
  if (!clean) throw new Error("Не указан ID тайтла в CVH");
  const url = `${CVH_API}/playlist?pub=${encodeURIComponent(pub)}&aggr=${encodeURIComponent(aggr)}&id=${encodeURIComponent(clean)}`;
  const data = await cvhRequest(url, proxy);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .map((item) => ({
      cvhId: String(item?.cvhId || ""),
      vkId: String(item?.vkId || ""),
      studio: String(item?.voiceStudio || "").trim(),
      voiceType: String(item?.voiceType || "").trim(),
      title: String(item?.name || "").trim(),
      season: Number(item?.season) || 1,
      episode: Number(item?.episode) || 1,
    }))
    .filter((item) => item.vkId && item.episode);
}

/** Озвучки, которые есть в плейлисте: [{ studio, count }]. */
export function cvhStudios(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const name = String(item?.studio || "").trim();
    if (!name) return;
    map.set(name, (map.get(name) || 0) + 1);
  });
  return [...map.entries()]
    .map(([studio, count]) => ({ studio, count }))
    .sort((a, b) => b.count - a.count || a.studio.localeCompare(b.studio, "ru"));
}

/** Прямая ссылка на поток конкретной серии CVH (живёт около суток). */
export async function cvhVideo({ vkId, proxy = "" } = {}) {
  const clean = String(vkId || "").trim();
  if (!clean) throw new Error("Не указан идентификатор видео CVH");
  const data = await cvhRequest(`${CVH_API}/video/${encodeURIComponent(clean)}`, proxy);
  const list = data?.sources || {};
  const mp4 = list.mpegFullHdUrl || list.mpegHighUrl || list.mpegMediumUrl || list.mpegLowUrl || "";
  const url = mp4 || list.hlsUrl || "";
  if (!url) throw new Error("CVH не вернул ссылку на видео");
  return {
    url,
    hls: !mp4 && Boolean(list.hlsUrl),
    poster: data?.thumbUrl || "",
    duration: Number(data?.duration) || 0,
  };
}

/**
 * Серии CVH для нужной озвучки: [{ number, title, vkId, studio }].
 * В CVH идентификатор тайтла совпадает с MAL ID.
 */
export function cvhEpisodes(items = [], { translation = "", limit = 500 } = {}) {
  const wanted = String(translation || "").trim().toLowerCase();
  const byNumber = new Map();
  items.forEach((item) => {
    const studio = String(item?.studio || "").toLowerCase();
    if (wanted && !studio.includes(wanted)) return;
    const number = Number(item?.episode) || 0;
    if (!number || !item?.vkId) return;
    const existing = byNumber.get(number);
    // Серия уже есть с названием — вторую копию не берём
    if (existing && (existing.title || !item.title)) return;
    byNumber.set(number, {
      number,
      title: String(item.title || "").trim(),
      vkId: String(item.vkId),
      studio: item.studio || "",
    });
  });
  return [...byNumber.values()].sort((a, b) => a.number - b.number).slice(0, limit);
}

/** Игрок типа cvh хранит в url только идентификатор видео: cvh:<vkId>. */
export function cvhPlayerUrl(vkId) {
  return `cvh:${String(vkId || "").trim()}`;
}

export function cvhIdFromUrl(url) {
  const match = /^cvh:(\d+)$/.exec(String(url || "").trim());
  return match ? match[1] : "";
}

/* ---------- Kodik → карточки каталога ---------- */
const CYR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

export function translitSlug(text) {
  return String(text || "")
    .toLowerCase()
    .split("")
    .map((char) => (char in CYR ? CYR[char] : char))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "anime";
}

/** Совпадает ли озвучка элемента Kodik с фильтром («Рабочая партия»). */
/* Название озвучки сравниваем «по-человечески»: регистр, неразрывные пробелы,
   кавычки, тире и лишние пробелы не должны мешать. «Рабочая партия» = «Рабочая Партия». */
export function normalizeVoiceName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u00a0\u2007\u2009\u200b\u202f\ufeff]/g, " ")
    .replace(/[«»"'`.,:;!?()[\]{}\/\\|—–−]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Находит озвучку в списке Kodik: точное совпадение → вхождение → все слова. */
export function matchVoice(list, filter) {
  const wanted = normalizeVoiceName(filter);
  const items = (Array.isArray(list) ? list : []).filter((item) => item && item.title);
  if (!items.length) return null;
  if (!wanted) return items[0];
  const scored = items.map((item) => ({ item, key: normalizeVoiceName(item.title) }));
  const exact = scored.find((entry) => entry.key === wanted);
  if (exact) return exact.item;
  const inside = scored.find((entry) => entry.key.includes(wanted) || (wanted.includes(entry.key) && entry.key.length > 3));
  if (inside) return inside.item;
  const tokens = wanted.split(" ").filter(Boolean);
  const byTokens = scored.find((entry) => tokens.every((token) => entry.key.includes(token)));
  return byTokens ? byTokens.item : null;
}

/** Похожие названия — чтобы подсказать, как озвучка записана в Kodik. */
export function suggestVoices(list, filter, limit = 4) {
  const wanted = normalizeVoiceName(filter);
  const tokens = wanted.split(" ").filter((token) => token.length > 2);
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((item) => {
    const key = normalizeVoiceName(item?.title);
    if (!key || seen.has(key)) return;
    if (tokens.length && !tokens.some((token) => key.includes(token))) return;
    seen.add(key);
    out.push(item.title);
  });
  return out.slice(0, limit);
}

export function kodikMatchesTranslation(item, filter) {
  const wanted = normalizeVoiceName(filter);
  if (!wanted) return true;
  const name = normalizeVoiceName(item?.translation?.title);
  if (!name) return false;
  return name.includes(wanted) || (wanted.includes(name) && name.length > 3);
}

/**
 * Превращает элементы Kodik в карточки, пригодные для каталога:
 * серия = плеер этой озвучки. Постер берётся с Shikimori по его ID.
 */
export function kodikCatalogEntries(items = [], { translation = "Рабочая партия", limit = 300 } = {}) {
  const entries = [];
  const seen = new Set();
  items.forEach((item) => {
    if (entries.length >= limit) return;
    if (!kodikMatchesTranslation(item, translation)) return;
    const episodes = Array.isArray(item.episodes) && item.episodes.length ? item.episodes : kodikEpisodes(item);
    if (!episodes.length) return;
    const title = String(item.title || item.title_orig || "").trim();
    if (!title) return;
    const shikimoriId = String(item.shikimoriId || item.shikimori_id || "");
    const key = shikimoriId || translitSlug(title);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      id: `kodik-${translitSlug(item.id || title)}`,
      source: "kodik",
      title,
      originalTitle: String(item.originalTitle || item.title_orig || "").trim(),
      year: Number(item.year) || new Date().getFullYear(),
      shikimoriId,
      poster: shikimoriId ? posterUrlById(shikimoriId) : "",
      /* кадр из серии — запасная «обложка» для шапки, если постера нет */
      banner: Array.isArray(item.screenshots) && item.screenshots.length ? String(item.screenshots[0]) : "",
      episodesCount: episodes.length,
      episodes: episodes.map((episode) => ({
        number: episode.number,
        title: "",
        date: "",
        duration: "",
        players: [{
          name: String(item.translation?.title || translation || "Плеер").trim(),
          type: "iframe",
          url: episode.link,
          code: "",
        }],
      })),
    });
  });
  return entries;
}

export { stripHtml, KIND_LABELS };
