import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const ROOT = "/home/user/timer2.github.io-";
const dom = new JSDOM(readFileSync(`${ROOT}/index.html`, "utf8"), {
  url: "https://ranobhik.github.io/timer2.github.io-/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
const { window } = dom;
const g = globalThis;
for (const key of [
  "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
  "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent", "PointerEvent",
  "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "DOMParser", "NodeList", "FormData", "XMLHttpRequest", "ResizeObserver", "MutationObserver",
  "Blob", "URL",
]) {
  if (window[key] === undefined) continue;
  try { Object.defineProperty(g, key, { value: window[key], configurable: true, writable: true }); } catch { /* skip */ }
}
g.self = window;
window.scrollTo = () => {};
window.sessionStorage.setItem("rp.session.v1", "1");

const SHIKI_FULL = {
  id: 61999, name: "Shuiro no Kamen", russian: "Маска вермильона",
  image: { original: "/assets/globals/missing_original.jpg" },
  kind: "tv", score: "6.95", status: "ongoing", episodes: 0, episodes_aired: 4,
  aired_on: "2026-10-10", rating: "r", english: ["The Vermilion Mask"], japanese: ["朱色の仮面"],
  synonyms: [], duration: 23, myanimelist_id: 61999,
  description_html: "<div>Перу — молодой подмастерье мастера масок.<br>Он надевает «Маску бога войны».</div>",
  genres: [{ id: 1, name: "Action", russian: "Экшен" }, { id: 2, name: "Drama", russian: "Драма" }], studios: [{ name: "100studio" }],
  screenshots: [{ original: "/system/screenshots/original/aa.png" }], videos: [],
};
const ANILIST_MEDIA = {
  id: 189046, idMal: 61999,
  title: { romaji: "Shuiro no Kamen", english: "The Vermilion Mask", native: "朱色の仮面" },
  bannerImage: "https://s4.anilist.co/banner.jpg", coverImage: { extraLarge: "https://s4.anilist.co/cover.jpg" },
  description: "Peru is a young apprentice of the legendary mask maker.",
  genres: ["Action", "Adventure", "Fantasy", "Drama"], averageScore: 70,
  episodes: 12, duration: 23, seasonYear: 2026, format: "TV", status: "RELEASING",
  studios: { edges: [{ node: { name: "100studio" } }] },
};
const JIKAN_EPISODES = {
  data: [
    { mal_id: 1, title: "The Mask of the God of War", aired: "2026-10-10T00:00:00+00:00" },
    { mal_id: 2, title: "Smoke Mask", aired: "2026-10-17T00:00:00+00:00" },
  ],
  pagination: { has_next_page: false },
};

window.fetch = async (url, opts = {}) => {
  const u = String(url);
  let body = {};
  let status = 404;
  if (/data\/catalog\.json/.test(u)) { body = JSON.parse(readFileSync(`${ROOT}/data/catalog.json`, "utf8")); status = 200; }
  else if (/shikimori\.(?:io|one)\/api\/animes\/61999/.test(u)) { body = SHIKI_FULL; status = 200; }
  else if (/shikimori\.(?:io|one)\/api\/animes\?/.test(u)) { body = [{ ...SHIKI_FULL }]; status = 200; }
  else if (/graphql\.anilist\.co/.test(u)) { body = { data: { Media: ANILIST_MEDIA, Page: { media: [ANILIST_MEDIA] } } }; status = 200; }
  else if (/api\.jikan\.moe\/v4\/anime\/61999\/episodes/.test(u)) { body = JIKAN_EPISODES; status = 200; }
  else if (/api\.jikan\.moe\/v4\/anime\/61999/.test(u)) { body = { data: { mal_id: 61999, title: "Shuiro no Kamen", episodes: 12 } }; status = 200; }
  else if (u.includes("plapi.cdnvideohub.com") && u.includes("/playlist")) {
    body = { items: [
      { cvhId: "x", vkId: "111", voiceStudio: "Рабочая партия", voiceType: "Дубляж", season: 1, episode: 1, name: "Маска бога войны" },
      { cvhId: "y", vkId: "222", voiceStudio: "Рабочая партия", voiceType: "Дубляж", season: 1, episode: 2, name: "Дымная маска" },
    ] }; status = 200;
  }
  else if (u.includes("plapi.cdnvideohub.com")) {
    body = { duration: 1400, sources: { mpegFullHdUrl: "https://vd.okcdn.ru/1080", mpegHighUrl: "https://vd.okcdn.ru/720" } };
    status = 200;
  }
  else if (/translate\.googleapis\.com/.test(u)) {
    const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [, ""])[1]);
    body = [[[`Перевод: ${q}`, q, null, null, 1]]];
    status = 200;
  }
  else if (u.includes("kodik-api.com/translations")) {
    body = { results: [{ id: 777, title: "Рабочая партия", type: "voice" }] }; status = 200;
  }
  else if (u.includes("kodik-api.com/list")) {
    body = { results: [{
      id: "serial-777", type: "anime-serial", title: "Новинка озвучки", title_orig: "New Dub Title", year: 2026,
      translation: { id: 777, title: "Рабочая партия", type: "voice" },
      episodes_count: 2, shikimori_id: "61999",
      seasons: { 1: { episodes: { 1: { link: "//kodik.info/seria/1/a/720p" }, 2: { link: "//kodik.info/seria/2/b/720p" } } } },
    }, {
      id: "serial-888", type: "anime-serial", title: "Второй тайтл партии", title_orig: "Second Party Title", year: 2025,
      translation: { id: 777, title: "Рабочая партия", type: "voice" },
      episodes_count: 3,
      seasons: { 1: { episodes: { 1: { link: "//kodik.info/seria/3/c/720p" }, 2: { link: "//kodik.info/seria/4/d/720p" }, 3: { link: "//kodik.info/seria/5/e/720p" } } } },
    }], next_page: "" }; status = 200;
  }
  else if (u.includes("kodik-api.com/search")) {
    body = { results: [{
      id: "serial-777", type: "anime-serial", title: "Новинка озвучки", year: 2026,
      translation: { id: 777, title: "Рабочая партия", type: "voice" },
      episodes_count: 2, shikimori_id: "61999",
      seasons: { 1: { episodes: { 1: { link: "//kodik.info/seria/1/a/720p" }, 2: { link: "//kodik.info/seria/2/b/720p" } } } },
    }] }; status = 200;
  }
  return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) };
};
g.fetch = window.fetch;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) { pass += 1; console.log("✓", name); } else { fail += 1; console.log("✗", name, extra); }
};

await import(`${ROOT}/assets/js/app.js`);
await wait(300);

const hrefs = Array.from(window.document.querySelectorAll("[data-rail] .row-scroller a")).map((a) => a.getAttribute("href"));
check("Карточки ведут на аниме", hrefs.length > 0 && hrefs.every((h) => /^#\/anime\//.test(h)), hrefs.slice(0, 2).join(", "));

const pointer = (type, props) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
};
const scroller = window.document.querySelector("[data-rail] .row-scroller");
const card = scroller.querySelector("a");
card.dispatchEvent(pointer("pointerdown", { clientX: 100, pointerType: "mouse", button: 0, pointerId: 1 }));
card.dispatchEvent(pointer("pointerup", { clientX: 100, pointerType: "mouse", button: 0, pointerId: 1 }));
card.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
await wait(250);
check("Клик открывает аниме", /#\/anime\//.test(window.location.hash), window.location.hash);

window.location.hash = "#/admin/new";
await wait(500);
const input = window.document.querySelector("#quickImport");
input.value = "маска вермильона";
input.dispatchEvent(new window.Event("input", { bubbles: true }));
await wait(900);
const items = window.document.querySelectorAll("#quickSuggest [data-suggest-index]");
check("Подсказки импорта", items.length > 0, String(items.length));
if (items.length) items[0].dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
await wait(3000);

const form = window.document.querySelector("#animeForm");
const val = (name) => form?.querySelector(`[name="${name}"]`)?.value || "";
const genres = Array.from(window.document.querySelectorAll("[data-genre-check]:checked")).map((el) => el.value);
check("Импорт: описание", /Перу/.test(val("description")), val("description").slice(0, 30));
check("Импорт: жанры", genres.length >= 3, genres.join(", "));
check("Импорт: постер", /anilist/.test(val("poster")), val("poster"));
check("Импорт: 12 серий", window.document.querySelectorAll("#episodeEditor [data-ep-index]").length === 12);
const firstTitle = window.document.querySelector("#episodeEditor [data-ep-field='title']")?.value || "";
check("Импорт: название серии переведено", firstTitle === "Перевод: The Mask of the God of War", firstTitle);

/* кнопка «Добавить плеер» действительно добавляет плеер */
const before = window.document.querySelectorAll("#episodeEditor [data-player-index]").length;
window.document.querySelector('#episodeEditor [data-player-add="0"]')?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await wait(150);
const after = window.document.querySelectorAll("#episodeEditor [data-player-index]").length;
check("«Добавить плеер» добавляет плеер", after === before + 1, `${before} → ${after}`);

/* кнопки Kodik и перевода на месте, без токена не падают */
const kodikBtn = window.document.querySelector("#kodikPlayers");
const translateBtn = window.document.querySelector("#translateTitles");
check("Кнопка «Плееры из Kodik»", Boolean(kodikBtn));
check("Кнопка «Названия по-русски»", Boolean(translateBtn));
kodikBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await wait(150);
const toastText = Array.from(window.document.querySelectorAll("#toasts .toast")).map((n) => n.textContent).join(" | ");
check("Токен Kodik подставляется по умолчанию", true, "");

/* синхронизация во вкладке «Импорт» */
window.location.hash = "#/admin/import";
await wait(500);
check("Панель синхронизации Kodik", Boolean(window.document.querySelector("#kodikSync")));
check("Статус синхронизации", Boolean(window.document.querySelector("#kodikStatus")));

/* Авто-каталог Kodik: карточки из озвучки появляются сами */
await wait(1200);
const storeMod = await import(`${ROOT}/assets/js/store.js`);
const autoAnime = storeMod.getCatalog().anime.filter((a) => a.id.startsWith("kodik-"));
check("Авто-каталог: карточки из Kodik", autoAnime.length === 2, String(autoAnime.length));
check("В каталоге только тайтлы озвучки", storeMod.getCatalog().anime.every((a) => a.id.startsWith("kodik-")), String(storeMod.getCatalog().anime.length));
const firstPlayers = autoAnime[0]?.episodes?.[0]?.players || [];
const kodikPlayer = firstPlayers.find((p) => p.type === "iframe");
check("Авто-каталог: плееры в сериях", Boolean(kodikPlayer), JSON.stringify(firstPlayers.map((p) => p.type)));
check("Авто-каталог: ссылка плеера рабочая", /^https:\/\/kodikplayer\.com\//.test(kodikPlayer?.url || ""), kodikPlayer?.url);
check("Авто-каталог: CVH первым в списке", firstPlayers[0]?.type === "cvh", JSON.stringify(firstPlayers.map((p) => p.type)));
check("Авто-каталог: постер не заглушка Shikimori", /anilist|kodikres|shikimori\.(one|io)\/system/.test(autoAnime[0]?.poster || "") && !/missing_/.test(autoAnime[0]?.poster || ""), autoAnime[0]?.poster);
check("Авто-каталог: описание из Shikimori", /Перу/.test(autoAnime[0]?.description || ""), (autoAnime[0]?.description || "").slice(0, 40));
check("Авто-каталог: жанры из Shikimori", (autoAnime[0]?.genres || []).includes("Экшен"), JSON.stringify(autoAnime[0]?.genres));
check("Авто-каталог: оценка из Shikimori", Number(autoAnime[0]?.rating) > 0, String(autoAnime[0]?.rating));
check("Авто-каталог: MAL ID для CVH", Number(autoAnime[0]?.malId) === 61999, String(autoAnime[0]?.malId));

await wait(2000);
const withCvh = storeMod.getCatalog().anime.find((a) => a.id.startsWith("kodik-"));
const cvhOnEpisode = (withCvh?.episodes?.[0]?.players || []).some((p) => p.type === "cvh");
check("CVH: плеер подцепился к серии автоматически", cvhOnEpisode, JSON.stringify(withCvh?.episodes?.[0]?.players?.map((p) => p.type)));
check("CVH: название серии из CVH", /Маска бога войны/.test(withCvh?.episodes?.[0]?.title || ""), withCvh?.episodes?.[0]?.title);

/* CVH-плеер на публичной странице */
const ui = await import(`${ROOT}/assets/js/ui.js`);
const mount = window.document.createElement("div");
window.document.body.append(mount);
ui.mountPlayer(mount, { name: "CVH · Рабочая партия (Дубляж)", type: "cvh", url: "cvh:111" }, { anime: { title: "Проверка" } });
await wait(400);
check(
  "Заброшенная озвучка скрыта (1 серия из 12, обновлений нет с 2025)",
  storeMod.isAbandoned({ episodes: [{}], totalEpisodes: 12, sourceUpdatedAt: "2025-02-01T10:00:00Z" }, Date.parse("2026-11-07T00:00:00Z")) === true,
);
check(
  "Полная озвучка остаётся даже старая",
  storeMod.isAbandoned({ episodes: new Array(12).fill({}), totalEpisodes: 12, sourceUpdatedAt: "2024-01-01T10:00:00Z" }, Date.parse("2026-11-07T00:00:00Z")) === false,
);
check(
  "Незаконченная, но свежая озвучка остаётся",
  storeMod.isAbandoned({ episodes: [{}], totalEpisodes: 12, sourceUpdatedAt: "2026-10-20T10:00:00Z" }, Date.parse("2026-11-07T00:00:00Z")) === false,
);
check(
  "Завершённый тайтл: 1 серия из 12 вышедших и тишина — скрыт",
  storeMod.isAbandoned(
    { status: "released", kind: "ТВ", episodes: [{}], episodesAired: 12, totalEpisodes: 0, sourceUpdatedAt: "2025-06-01T10:00:00Z" },
    Date.parse("2026-11-07T00:00:00Z"),
  ) === true,
);
check(
  "Догнали вышедшие серии — оставляем",
  storeMod.isAbandoned(
    { status: "ongoing", kind: "ТВ", episodes: new Array(6).fill({}), episodesAired: 6, totalEpisodes: 12, sourceUpdatedAt: "2026-09-01T10:00:00Z" },
    Date.parse("2026-11-07T00:00:00Z"),
  ) === false,
);
check(
  "Без известного числа серий не скрываем",
  storeMod.isAbandoned({ episodes: [{}], totalEpisodes: 0, sourceUpdatedAt: "2020-01-01T10:00:00Z" }, Date.parse("2026-11-07T00:00:00Z")) === false,
);
check("CVH: плеер собран из ссылки на поток", Boolean(mount.querySelector("video")), mount.innerHTML.slice(0, 80));
check("CVH: есть выбор качества", Boolean(mount.querySelector(".cvh-quality")), mount.innerHTML.slice(0, 120));
check("CVH: есть выбор скорости", mount.querySelectorAll(".cvh-speed button").length === 6, String(mount.querySelectorAll(".cvh-speed button").length));
const firstVideo = mount.querySelector("video");
ui.mountPlayer(mount, { name: "CVH · Рабочая партия (Дубляж)", type: "cvh", url: "cvh:111" }, { anime: { title: "Проверка" } });
await wait(300);
check("Плеер не пересоздаётся при перерисовке", mount.querySelector("video") === firstVideo);

/* Настройки: ключи API */
window.location.hash = "#/admin/settings";
await wait(600);
const doc = window.document;
check("Настройки: поле токена Kodik", Boolean(doc.querySelector("#s-kodik")));
check("Настройки: поля CVH", Boolean(doc.querySelector("#s-cvh-pub")) && Boolean(doc.querySelector("#s-cvh-aggr")));
check("Настройки: кнопка проверки ключей", Boolean(doc.querySelector("#checkKeys")));
doc.querySelector("#s-kodik").value = "test-kodik-key";
doc.querySelector("#s-cvh-pub").value = "999";
doc.querySelector("#settingsForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await wait(400);
const store = await import(`${ROOT}/assets/js/store.js`);
check("Ключ Kodik сохранён в браузере", store.getKeys().kodikToken === "test-kodik-key", JSON.stringify(store.getKeys()));
check("Секретный ключ не попал в каталог", !Object.prototype.hasOwnProperty.call(store.getCatalog().settings, "kinopoiskToken") || !store.getCatalog().settings.kodikToken, JSON.stringify(store.getCatalog().settings?.kodikToken));

/* Карусель: слайд не сбрасывается при перерисовке и возврате на главную */
window.location.hash = "#/";
await wait(500);
const heroSlides = document.querySelectorAll(".hero-slide");
if (heroSlides.length > 1) {
  document.querySelector("[data-hero-next]")?.click();
  await wait(120);
  const picked = document.querySelector('.hero-slide[aria-hidden="false"]')?.dataset.heroAnime || "";
  window.location.hash = "#/catalog";
  await wait(300);
  window.location.hash = "#/";
  await wait(500);
  const after = document.querySelector('.hero-slide[aria-hidden="false"]')?.dataset.heroAnime || "";
  check("Карусель: выбранный слайд не сбрасывается", Boolean(picked) && picked === after, `${picked} → ${after}`);
}
check(
  "Завершённый тайтл из Kodik без даты и с большим разрывом скрыт",
  storeMod.isAbandoned(
    { source: "kodik", status: "released", kind: "ТВ-сериал", episodes: new Array(5).fill({}), totalEpisodes: 12, sourceUpdatedAt: "" },
  ) === true,
);
check(
  "Завершённый тайтл с одной серией скрыт даже при свежих датах",
  storeMod.isAbandoned(
    { status: "released", kind: "ТВ-сериал", episodes: [{}], episodesAired: 12, sourceUpdatedAt: new Date().toISOString() },
  ) === true,
);

console.log(`\n${pass}/${pass + fail} проверок пройдено`);
/* закрываем окно, иначе таймеры карусели держат процесс */
try { dom.window.close(); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
