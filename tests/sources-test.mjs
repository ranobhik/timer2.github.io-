import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.com/" });
const g = globalThis;
for (const [key, value] of [["document", dom.window.document], ["window", dom.window]]) {
  try { Object.defineProperty(g, key, { value, configurable: true, writable: true }); } catch { /* skip */ }
}

const SHIKI = {
  61999: {
    id: 61999, name: "Shuiro no Kamen", russian: "Маска вермильона",
    image: { original: "/assets/globals/missing_original.jpg" },
    kind: "tv", score: "6.95", status: "ongoing", episodes: 0, episodes_aired: 4,
    aired_on: "2026-10-10", rating: "r", english: ["The Vermilion Mask"], japanese: ["朱色の仮面"],
    synonyms: [], duration: 23, myanimelist_id: 61999,
    description: "[character=1]Перу[/character] — подмастерье мастера масок.",
    description_html: "<div><a href='#'>Перу</a> — подмастерье мастера масок.<br>Он надевает «Маску бога войны».</div>",
    genres: [], studios: [{ name: "100studio" }],
    screenshots: [{ original: "/system/screenshots/original/aa.png" }], videos: [],
  },
};
const ANILIST = {
  189046: {
    id: 189046, idMal: 61999,
    title: { romaji: "Shuiro no Kamen", english: "The Vermilion Mask", native: "朱色の仮面" },
    bannerImage: "https://s4.anilist.co/banner.jpg", coverImage: { extraLarge: "https://s4.anilist.co/cover.jpg" },
    description: "Peru is a young apprentice of the legendary mask maker.",
    genres: ["Action", "Adventure", "Fantasy", "Drama"], averageScore: 70,
    episodes: 12, duration: 23, seasonYear: 2026, format: "TV", status: "RELEASING",
    studios: { edges: [{ node: { name: "100studio" } }] },
  },
};
const JIKAN = {
  61999: {
    mal_id: 61999, title: "Shuiro no Kamen", episodes: 12, duration: "23 min per ep", score: 7.1, year: 2026,
    synopsis: "Peru d'Arrest is a young apprentice of the mask maker.",
    genres: [{ name: "Action" }, { name: "Fantasy" }], themes: [{ name: "Historical" }],
    demographics: [{ name: "Shounen" }], studios: [{ name: "100studio" }],
    images: { jpg: { large_image_url: "https://cdn.myanimelist.net/poster.jpg" } },
  },
};
const JIKAN_EPISODES = {
  data: [
    { mal_id: 1, title: "The Mask of the God of War", aired: "2026-10-10T00:00:00+00:00" },
    { mal_id: 2, title: "Smoke Mask", aired: "2026-10-17T00:00:00+00:00" },
    { mal_id: 3, title: "Episode 3" },
  ],
  pagination: { has_next_page: false },
};
const KODIK_ITEM = {
  id: "serial-61999", type: "anime-serial", link: "//kodik.info/serial/61999/hash/720p",
  screenshots: ["https://i.kodikres.com/screenshots/seria/1677794/1.jpg"],
  title: "Маска вермильона", title_orig: "Shuiro no Kamen", year: 2026,
  translation: { id: 777, title: "Рабочая партия", type: "voice" },
  episodes_count: 4, shikimori_id: "61999",
  created_at: "2026-02-10T12:00:00Z", updated_at: "2026-03-01T12:00:00Z",
  seasons: {
    1: {
      link: "//kodik.info/season/61999/hash/720p",
      episodes: {
        1: { link: "//kodik.info/seria/1676458/aaa/720p" },
        2: { link: "//kodik.info/seria/1676459/bbb/720p" },
      },
    },
  },
};
const KP = {
  id: 999001, name: "Маска вермильона", alternativeName: "Shuiro no Kamen", enName: "The Vermilion Mask",
  year: 2026, isSeries: true, seriesLength: 12, movieLength: 24, rating: { kp: 7.4 }, ageRating: 16,
  description: "Описание с Кинопоиска, достаточно длинное для склейки.",
  poster: { url: "https://st.kp.yandex.net/p.jpg" }, backdrop: { url: "https://st.kp.yandex.net/bd.jpg" },
  genres: [{ name: "фэнтези" }], countries: [{ name: "Япония" }],
};

let jikanBroken = false;
let delayMs = 0;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  let body = {};
  let status = 404;
  let m;
  if ((m = u.match(/shikimori\.(?:io|one)\/api\/animes\/(\d+)/))) { body = SHIKI[m[1]] || null; status = body ? 200 : 404; }
  else if (/shikimori\.(?:io|one)\/api\/animes\?/.test(u)) {
    const q = decodeURIComponent((u.match(/search=([^&]*)/) || [, ""])[1]).toLowerCase();
    body = Object.values(SHIKI).filter((i) => i.russian.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
    status = 200;
  } else if (/graphql\.anilist\.co/.test(u)) {
    const vars = JSON.parse(opts.body || "{}").variables || {};
    if (vars.id) body = { data: { Media: ANILIST[String(vars.id)] || null } };
    else if (vars.idMal) body = { data: { Media: Object.values(ANILIST).find((i) => i.idMal === Number(vars.idMal)) || null } };
    else body = { data: { Page: { media: [ANILIST[189046]] } } };
    status = 200;
  } else if (/api\.jikan\.moe/.test(u)) {
    if (jikanBroken) throw new TypeError("Failed to fetch");
    if (/\/episodes/.test(u)) { body = JIKAN_EPISODES; status = 200; }
    else { const id = (u.match(/anime\/(\d+)/) || [])[1]; body = { data: JIKAN[id] || null }; status = body.data ? 200 : 404; }
  } else if (/kitsu\.io\/api\/edge\/anime\?/.test(u)) {
    body = { data: [{ id: "7442", attributes: { canonicalTitle: "Shuiro no Kamen", titles: {} } }] }; status = 200;
  } else if (/kitsu\.io\/api\/edge\/anime\/7442\/episodes/.test(u)) {
    body = { data: [{ attributes: { number: 1, canonicalTitle: "Kitsu episode one" } }] }; status = 200;
  } else if (/kodik-?api\.com\/translations/.test(u)) {
    body = { results: [{ id: 610, title: "AniLibria.TV", type: "voice" }, { id: 777, title: "Рабочая партия", type: "voice" }] };
    status = 200;
  } else if (/kodik-?api\.com\/search/.test(u)) { body = { results: [KODIK_ITEM] }; status = 200; }
  else if (/kodik-?api\.com\/list/.test(u)) { body = { results: [KODIK_ITEM], next_page: "" }; status = 200; }
  else if (/translate\.googleapis\.com/.test(u)) {
    const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [, ""])[1]);
    body = [[[`Перевод: ${q}`, q, null, null, 1]]]; status = 200;
  } else if (/api\.kinopoisk\.dev/.test(u)) { body = u.includes("/movie/search") ? { docs: [KP] } : KP; status = 200; }
  if (u.includes("plapi.cdnvideohub.com") && u.includes("/playlist")) {
    body = { titleName: "Аяка", isSerial: true, items: [
      { cvhId: "aaa", vkId: "111", voiceStudio: "Рабочая партия", voiceType: "Дубляж", season: 1, episode: 1 },
      { cvhId: "bbb", vkId: "222", voiceStudio: "Рабочая партия", voiceType: "Дубляж", season: 1, episode: 2 },
      { cvhId: "ccc", vkId: "333", voiceStudio: "AniLibria", voiceType: "Многоголосый", season: 1, episode: 1 },
    ] }; status = 200;
  } else if (u.includes("plapi.cdnvideohub.com") && u.includes("/video/")) {
    body = { duration: 1400, thumbUrl: "https://iv.okcdn.ru/p.jpg", sources: { mpegFullHdUrl: "", mpegHighUrl: "https://vd.okcdn.ru/720", hlsUrl: "https://vd.okcdn.ru/master.m3u8" } }; status = 200;
  }
  if (u.includes("api.jikan.moe/v4/anime?q=") || u.includes("api.jikan.moe/v4/anime?q")) {
    body = { data: [{ mal_id: 61999, title: "Shuiro no Kamen", year: 2026 }] }; status = 200;
  }
  if (u.includes("kodik-api.com/list")) {
    body = { results: [{ ...KODIK_ITEM, shikimori_id: "61999" }], next_page: "" }; status = 200;
  }
  return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) };
};

const ROOT = "/home/user/timer2.github.io-";
const sources = await import(`${ROOT}/assets/js/sources.js`);
const store = await import(`${ROOT}/assets/js/store.js`);
let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) { pass += 1; console.log("✓", name); } else { fail += 1; console.log("✗", name, extra); }
};

const shiki = await sources.importCandidate({ source: "shikimori", sourceId: "61999", title: "Маска вермильона" });
check("Описание на русском", /Перу/.test(shiki.description), shiki.description?.slice(0, 40));
check("Жанры переведены", shiki.genres.length >= 4 && shiki.genres.every((x) => /[а-яё]/i.test(x)), JSON.stringify(shiki.genres));
check("Постер из AniList", /anilist/.test(shiki.poster), shiki.poster);
check("Серии с названиями", shiki.episodeList?.length === 3, String(shiki.episodeList?.length));
check("Серий всего 12", shiki.episodesCount === 12, String(shiki.episodesCount));

const al = await sources.importCandidate({ source: "anilist", sourceId: "189046", title: "The Vermilion Mask" });
check("AniList→русское название", al.title === "Маска вермильона", al.title);
const kp = await sources.importCandidate({ source: "kinopoisk", sourceId: "999001" }, { kinopoiskToken: "t" });
check("Кинопоиск: постер", /kp\.yandex/.test(kp.poster), kp.poster);
check("genreToRu", sources.genreToRu("Slice of Life") === "Повседневность");

const base = await sources.importBase({ source: "shikimori", sourceId: "61999" });
check("importBase без склейки", base?.title === "Маска вермильона" && !base.episodeList, base?.title);

let network = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => { network += 1; return originalFetch(...args); };
dom.window.localStorage.clear();
await sources.importCandidate({ source: "shikimori", sourceId: "61999" });
network = 0;
await sources.importCandidate({ source: "shikimori", sourceId: "61999" });
check(`Кеш: повтор без сети (${network})`, network === 0, String(network));
globalThis.fetch = originalFetch;

dom.window.localStorage.clear();
jikanBroken = true;
const kitsu = await sources.importCandidate({ source: "shikimori", sourceId: "61999" });
check("Kitsu-фолбэк серий", kitsu.episodeList?.length === 1, JSON.stringify(kitsu.episodeList?.length));
jikanBroken = false;

dom.window.localStorage.clear();
delayMs = 250;
const t0 = Date.now();
await sources.importCandidate({ source: "shikimori", sourceId: "61999" });
check(`Параллельный импорт (${Date.now() - t0} мс)`, Date.now() - t0 < 800);
delayMs = 0;

/* Kodik */
const translations = await sources.kodikTranslations({ token: "t" });
check("Kodik: озвучки", translations.some((x) => x.title === "Рабочая партия"), JSON.stringify(translations));
const found = await sources.kodikSearch({ token: "t", shikimoriId: "61999" });
check("Kodik: поиск по Shikimori ID", found.length === 1 && found[0].shikimoriId === "61999", String(found.length));
check("Kodik: серии разобраны", found[0].episodes.length === 2 && found[0].episodes[1].number === 2, JSON.stringify(found[0].episodes));
check("Kodik: ссылки https", /kodikplayer\.com\/seria\//.test(found[0].episodes[0].link), found[0].episodes[0].link);
check("Kodik: озвучка", found[0].translation.title === "Рабочая партия", found[0].translation.title);
const list = await sources.kodikList({ token: "t", translationId: 777 });
check("Kodik: список тайтлов", list.length === 1 && list[0].episodes.length === 2, String(list.length));

/* Перевод */
dom.window.localStorage.removeItem("rp.translate.v1");
const map = await sources.translateTitles(["The Mask of the War God", "Маска дыма"]);
check("Перевод на русский", map["The Mask of the War God"] === "Перевод: The Mask of the War God", JSON.stringify(map));
check("Русское не переводим", map["Маска дыма"] === undefined, JSON.stringify(map));

/* CVH */
const cvh = await sources.cvhPlaylist({ id: "51019" });
check("CVH: плейлист разобран", cvh.length === 3 && cvh[0].vkId === "111", String(cvh.length));
const cvhStudios = sources.cvhStudios(cvh);
check("CVH: список озвучек", cvhStudios.length === 2 && cvhStudios[0].studio === "Рабочая партия", JSON.stringify(cvhStudios));
const dubItems = cvh.filter((item) => item.studio.toLowerCase().includes("рабочая партия"));
check("CVH: только нужная озвучка", dubItems.length === 2 && dubItems.every((i) => i.studio === "Рабочая партия"), String(dubItems.length));
const stream = await sources.cvhVideo({ vkId: "111" });
check("CVH: ссылка на поток", stream.url === "https://vd.okcdn.ru/720", stream.url);
const cvhDub = sources.cvhEpisodes([
  { episode: 1, vkId: "1", studio: "Рабочая партия", title: "The Mask" },
  { episode: 2, vkId: "2", studio: "Рабочая партия", title: "Smoke" },
  { episode: 1, vkId: "3", studio: "AniLibria", title: "The Mask" },
], { translation: "Рабочая партия" });
check("CVH: серии нужной озвучки", cvhDub.length === 2 && cvhDub[0].title === "The Mask", JSON.stringify(cvhDub));
check("CVH: ссылка плеера", sources.cvhPlayerUrl("111") === "cvh:111" && sources.cvhIdFromUrl("cvh:111") === "111");

/* Kodik → карточки каталога */
check("Транслит в slug", sources.translitSlug("Маска вермильона") === "maska-vermilonа" || sources.translitSlug("Маска вермильона").startsWith("maska-vermi"), sources.translitSlug("Маска вермильона"));
const catalogEntries = sources.kodikCatalogEntries([KODIK_ITEM], { translation: "Рабочая партия" });
check("Kodik→карточка: серии с плеерами", catalogEntries.length === 1 && catalogEntries[0].episodes.length === 2, JSON.stringify(catalogEntries[0]?.episodes?.length));
check("Kodik→карточка: плеер это ссылка Kodik", /kodikplayer\.com/.test(catalogEntries[0].episodes[0].players[0].url), catalogEntries[0]?.episodes?.[0]?.players?.[0]?.url);
check("Kodik→карточка: постер не выдумываем", catalogEntries[0].poster === "", catalogEntries[0].poster);
check("Kodik→карточка: кадр как запасная обложка", Boolean(catalogEntries[0].banner), catalogEntries[0].banner);
const malTotal = await sources.resolveEpisodeTotal({ malId: 61999 });
check("Число серий из MyAnimeList", malTotal.total === 12, JSON.stringify(malTotal));
const malTotalByTitle = await sources.resolveEpisodeTotal({ title: "Маска вермильона", year: 2026 });
check("Число серий по названию (поиск MAL)", malTotalByTitle.total === 12, JSON.stringify(malTotalByTitle));

check(
  "Kodik→карточка: даты загрузки и обновления сохранены",
  catalogEntries[0]?.sourceUpdatedAt === "2026-03-01T12:00:00.000Z" && catalogEntries[0]?.uploadedAt === "2026-02-10T12:00:00.000Z",
  `${catalogEntries[0]?.uploadedAt} / ${catalogEntries[0]?.sourceUpdatedAt}`,
);
check("Kodik→карточка: чужая озвучка отфильтрована", sources.kodikCatalogEntries([KODIK_ITEM], { translation: "AniLibria" }).length === 0);

/* Поиск MAL ID по названию */
const malId = await sources.resolveMalId("Shuiro no Kamen", 2026);
check("Поиск MAL ID по названию", malId === 61999, String(malId));

/* Ключи API хранятся в браузере */
store.saveKeys({ kodikToken: "k", kinopoiskToken: "p", cvhToken: "c" });
const storedKeys = store.getKeys();
check("Ключи: сохранение", storedKeys.kodikToken === "k" && storedKeys.cvhToken === "c", JSON.stringify(storedKeys));
check("Ключи: не в каталоге", !JSON.stringify(store.getCatalog()).includes('"cvhToken":"c"'));

/* Секреты не уходят в публичный каталог */
const exported = JSON.parse(store.exportJSON({ settings: { kodikToken: "secret", kinopoiskToken: "kp", title: "x" }, anime: [], genres: [] }));
check("Токены не публикуются", !exported.settings.kodikToken && !exported.settings.kinopoiskToken, JSON.stringify(exported.settings));
check("Остальные настройки сохраняются", exported.settings.title === "x", JSON.stringify(exported.settings));

/* Название озвучки: неразрывный пробел, кавычки и регистр не мешают */
check("Озвучка: неразрывный пробел", sources.kodikMatchesTranslation({ translation: { title: "Рабочая\u00a0партия" } }, "Рабочая партия"));
check("Озвучка: «ёлочки» и регистр", sources.kodikMatchesTranslation({ translation: { title: "«Рабочая Партия»" } }, "рабочая партия"));
check("Озвучка: двойной пробел", sources.kodikMatchesTranslation({ translation: { title: "Рабочая  партия" } }, "Рабочая партия"));
const voiceList = [{ id: 3466, title: "Рабочая\u00a0партия" }, { id: 610, title: "AniLibria" }];
check("Поиск озвучки в списке", sources.matchVoice(voiceList, "Рабочая партия")?.id === 3466, JSON.stringify(sources.matchVoice(voiceList, "Рабочая партия")));
check("Подсказка похожих озвучек", sources.suggestVoices(voiceList, "Рабочая партия").length === 1, JSON.stringify(sources.suggestVoices(voiceList, "Рабочая партия")));

/* Новый API отдаёт серии строкой, старый — объектом */
const stringSeasons = sources.kodikEpisodes({
  seasons: { 1: { episodes: { 1: "//kodikplayer.com/seria/1/a/720p", 2: "//kodikplayer.com/seria/2/b/720p" } } },
});
check("Серии Kodik: ссылки строками", stringSeasons.length === 2 && stringSeasons[0].link === "https://kodikplayer.com/seria/1/a/720p", JSON.stringify(stringSeasons));
const objectSeasons = sources.kodikEpisodes({
  seasons: { 1: { episodes: { 1: { link: "//kodik.info/seria/1/a/720p" } } } },
});
check("Серии Kodik: ссылки объектами", objectSeasons.length === 1 && objectSeasons[0].link === "https://kodikplayer.com/seria/1/a/720p", JSON.stringify(objectSeasons));

/* Смена доменов Kodik в 2026: старые ссылки чинятся на лету */
check("Kodik: старый домен → kodikplayer", sources.modernizeKodikUrl("https://kodik.info/seria/1/a/720p") === "https://kodikplayer.com/seria/1/a/720p");
check("Kodik: протокол-относительная ссылка", sources.modernizeKodikUrl("//kodik.biz/serial/2/b/720p") === "https://kodikplayer.com/serial/2/b/720p");
check("Kodik: чужие ссылки не трогаем", sources.modernizeKodikUrl("https://vk.com/video-1") === "https://vk.com/video-1");

/* Kodik блокируется напрямую — должен ответить прокси, без ожидания очереди */
const beforeRepair = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://kodik-api.com")) throw new TypeError("Failed to fetch");
  if (u.includes("allorigins")) {
    await new Promise((r) => setTimeout(r, 40));
    const body = { results: [{ id: 7, title: "Рабочая партия", type: "voice" }] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }
  throw new TypeError("Failed to fetch");
};
const raceStart = Date.now();
const viaProxy = await sources.kodikTranslations({ token: "t" });
const raceMs = Date.now() - raceStart;
check("Kodik через прокси, когда прямой путь закрыт", viaProxy[0]?.title === "Рабочая партия", JSON.stringify(viaProxy));
check(`Прокси: параллельно, а не по очереди (${raceMs} мс)`, raceMs < 400, String(raceMs));
const probes = await sources.probeKodik({ token: "t", timeout: 3000 });
check("Проверка ключей: отчёт по каждому пути", probes.length >= 5 && probes.filter((p) => p.ok).length === 1, JSON.stringify(probes.map((p) => `${p.label}:${p.ok}`)));
globalThis.fetch = beforeRepair;

console.log(`\n${pass}/${pass + fail} проверок пройдено`);
if (fail) process.exit(1);
