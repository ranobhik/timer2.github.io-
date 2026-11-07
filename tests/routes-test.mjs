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
  "Blob", "URL", "Image",
]) {
  if (window[key] === undefined) continue;
  try { Object.defineProperty(g, key, { value: window[key], configurable: true, writable: true }); } catch { /* skip */ }
}
g.self = window;
window.scrollTo = () => {};
window.sessionStorage.setItem("rp.session.v1", "1");

const SHIKI = {
  id: 61999, name: "Shuiro no Kamen", russian: "Маска вермильона",
  image: { original: "/assets/globals/missing_original.jpg" },
  kind: "tv", score: "6.95", status: "ongoing", episodes: 0, episodes_aired: 4,
  aired_on: "2026-10-10", rating: "r", english: ["The Vermilion Mask"], japanese: ["朱色の仮面"],
  synonyms: [], duration: 23, myanimelist_id: 61999,
  description_html: "<div>Перу — подмастерье мастера масок.<br>Он надевает «Маску бога войны».</div>",
  genres: [], studios: [{ name: "100studio" }],
  screenshots: [{ original: "/system/screenshots/original/aa.png" }], videos: [],
};
const ANILIST = {
  id: 189046, idMal: 61999,
  title: { romaji: "Shuiro no Kamen", english: "The Vermilion Mask", native: "朱色の仮面" },
  bannerImage: "https://s4.anilist.co/banner.jpg", coverImage: { extraLarge: "https://s4.anilist.co/cover.jpg" },
  description: "Peru is a young apprentice.", genres: ["Action", "Drama"], averageScore: 70,
  episodes: 12, duration: 23, seasonYear: 2026, format: "TV", status: "RELEASING",
  studios: { edges: [{ node: { name: "100studio" } }] },
};
const KODIK_ITEM = {
  id: "serial-777", type: "anime-serial", title: "Маска вермильона", title_orig: "Shuiro no Kamen", year: 2026,
  translation: { id: 777, title: "Рабочая партия", type: "voice" },
  episodes_count: 2, shikimori_id: "61999",
  seasons: { 1: { episodes: { 1: { link: "//kodik.info/seria/1/a/720p" }, 2: { link: "//kodik.info/seria/2/b/720p" } } } },
};

window.fetch = async (url) => {
  const u = String(url);
  let body = {};
  let status = 404;
  if (/data\/catalog\.json/.test(u)) { body = JSON.parse(readFileSync(`${ROOT}/data/catalog.json`, "utf8")); status = 200; }
  else if (/shikimori\.(?:io|one)\/api\/animes\/61999/.test(u)) { body = SHIKI; status = 200; }
  else if (/shikimori\.(?:io|one)\/api\/animes\?/.test(u)) { body = [SHIKI]; status = 200; }
  else if (/graphql\.anilist\.co/.test(u)) { body = { data: { Media: ANILIST, Page: { media: [ANILIST] } } }; status = 200; }
  else if (/api\.jikan\.moe\/v4\/anime\/61999\/episodes/.test(u)) {
    body = { data: [{ mal_id: 1, title: "The Mask of the God of War", aired: "2026-10-10T00:00:00+00:00" }], pagination: { has_next_page: false } };
    status = 200;
  }
  else if (/api\.jikan\.moe\/v4\/anime\/61999/.test(u)) { body = { data: { mal_id: 61999, title: "Shuiro no Kamen", episodes: 12 } }; status = 200; }
  else if (/kodikapi\.com\/translations/.test(u)) { body = { results: [{ id: 777, title: "Рабочая партия", type: "voice" }] }; status = 200; }
  else if (/kodikapi\.com\/(search|list)/.test(u)) { body = { results: [KODIK_ITEM], next_page: "" }; status = 200; }
  else if (/plapi\.cdnvideohub\.com.*playlist/.test(u)) {
    body = { items: [
      { cvhId: "a", vkId: "111", voiceStudio: "Рабочая партия", voiceType: "Дубляж", season: 1, episode: 1, name: "The Mask of the God of War" },
      { cvhId: "b", vkId: "222", voiceStudio: "Рабочая партия", voiceType: "Дубляж", season: 1, episode: 2, name: "Smoke Mask" },
    ] };
    status = 200;
  }
  else if (/plapi\.cdnvideohub\.com.*video/.test(u)) { body = { sources: { mpegHighUrl: "https://vd.okcdn.ru/720" } }; status = 200; }
  else if (/translate\.googleapis\.com/.test(u)) {
    const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [, ""])[1]);
    body = [[[`Перевод: ${q}`, q, null, null, 1]]];
    status = 200;
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

const problems = [];
window.addEventListener("error", (event) => problems.push(String(event.message || event.error || "error")));
process.on("unhandledRejection", (reason) => problems.push(String(reason)));

await import(`${ROOT}/assets/js/app.js`);
await wait(1500);

const store = await import(`${ROOT}/assets/js/store.js`);
const animeList = store.getCatalog().anime;
check("Каталог собрался из озвучки", animeList.length > 0, String(animeList.length));
const first = animeList[0];
const ep = first?.episodes?.[0];

const routes = [
  "#/",
  "#/catalog",
  "#/catalog?sort=rating",
  "#/catalog?genre=" + encodeURIComponent("Экшен"),
  `#/anime/${first?.id}`,
  ep ? `#/watch/${first.id}/ep-${ep.number}` : "#/",
  "#/favorites",
  "#/about",
  "#/admin",
  "#/admin/content",
  "#/admin/import",
  "#/admin/genres",
  "#/admin/settings",
  "#/admin/publish",
  "#/admin/new",
  `#/admin/edit/${first?.id}`,
  "#/nonexistent",
];

for (const route of routes) {
  const before = problems.length;
  window.location.hash = route;
  await wait(route.startsWith("#/admin") ? 700 : 400);
  const viewEl = window.document.getElementById("view");
  const text = viewEl?.textContent || "";
  const empty = !viewEl || viewEl.children.length === 0;
  const broken = /undefined|NaN|\[object Object\]/.test(text);
  const err = problems.slice(before);
  check(
    `Роут ${route}`,
    !empty && !broken && err.length === 0,
    `${empty ? "пусто " : ""}${broken ? "битый текст " : ""}${err.join(" | ")}`.trim(),
  );
}

/* CVH без сохранённого MAL ID: подтягивается по Shikimori ID */
window.location.hash = `#/admin/edit/${first.id}`;
await wait(900);
const cvhBtn = window.document.querySelector("#cvhPlayers");
check("Кнопка CVH в редакторе", Boolean(cvhBtn));
cvhBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await wait(1500);
const cvhPlayers = window.document.querySelectorAll("#episodeEditor [data-pl-field='type']");
const hasCvh = Array.from(cvhPlayers).some((el) => el.value === "cvh");
check("CVH подставил плееры по Shikimori ID", hasCvh, `${cvhPlayers.length} плееров`);

/* черновик: кнопка «Убрать черновик» */
window.localStorage.setItem("rp.draft.v1", JSON.stringify({ savedAt: new Date().toISOString(), data: { anime: [{ id: "old", title: "Старый тайтл", episodes: [] }], genres: [] } }));
window.location.hash = "#/admin/content";
await wait(900);
check("Плашка черновика с кнопкой", Boolean(window.document.querySelector("#dropDraft")));

console.log(`\n${pass}/${pass + fail} проверок пройдено`);
if (fail) process.exit(1);
