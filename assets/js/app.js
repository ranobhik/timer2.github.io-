/* «Рабочая партия» — точка входа: роутер, страницы, тема, поиск. */

import * as store from "./store.js";
import * as ui from "./ui.js";
import {
  $, $$, attr, debounce, esc, formatDate, hueFrom, pluralEpisodes, safeUrl, statusLabel,
} from "./utils.js";

const view = document.getElementById("view");
const siteHeader = document.getElementById("siteHeader");
const headerInner = document.getElementById("headerInner");
const mainNav = document.getElementById("mainNav");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const themeToggle = document.getElementById("themeToggle");
const navToggle = document.getElementById("navToggle");

let catalog = null;
let prefs = null;
let searchHandler = null;
let lastRenderedPath = "";

/* =======================================================================
   Инициализация
   ======================================================================= */
async function boot() {
  catalog = await store.loadCatalog();
  prefs = store.getPrefs();
  applySettings();
  buildNav();
  bindGlobalUI();
  syncHeaderOffset();

  if (!location.hash) {
    history.replaceState(null, "", "#/");
  }
  render();
  window.addEventListener("hashchange", render);

  if (store.getState().loadError) {
    ui.toast("Каталог data/catalog.json не загружен — открыт пустой проект", "err");
  }
}

function settings() {
  return catalog.settings;
}

/* ---------- Настройки внешнего вида ---------- */
function applySettings() {
  const s = settings();
  const root = document.documentElement;
  root.style.setProperty("--accent", s.accent || "#f43f5e");
  root.style.setProperty("--accent-2", s.accent2 || "#8b5cf6");

  const theme = prefs?.theme || s.theme || "dark";
  root.dataset.theme = theme === "light" ? "light" : "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f6f7fb" : "#07070c";

  document.title = `${s.siteName} — ${s.tagline}`;
  document.querySelectorAll("[data-site-name]").forEach((n) => { n.textContent = s.siteName; });
  document.querySelectorAll("[data-site-tagline]").forEach((n) => { n.textContent = s.tagline; });
  document.querySelectorAll("[data-site-description]").forEach((n) => { n.textContent = s.description; });
  document.querySelectorAll("[data-footer-text]").forEach((n) => { n.textContent = s.footerText; });

  const logo = String(s.logo || "").trim();
  const marks = [$("#brandMark"), ...$$("[data-site-mark]")];
  marks.forEach((el) => {
    if (!el) return;
    const src = safeUrl(logo);
    if (src) el.innerHTML = `<img src="${attr(src)}" alt="" />`;
    else el.textContent = logo.slice(0, 2) || "★";
  });

  // Объявление
  const announce = document.getElementById("announce");
  const track = document.getElementById("announceTrack");
  if (announce && track) {
    const text = String(s.announcement?.text || "").trim();
    if (s.announcement?.enabled && text) {
      track.innerHTML = [0, 1, 2, 3].map(() => `<span>${esc(text)}</span>`).join("");
      announce.hidden = false;
    } else {
      announce.hidden = true;
    }
  }

  // Соцсети
  const socials = document.getElementById("socials");
  if (socials) {
    const map = [
      ["telegram", "i-tg", "Telegram"],
      ["discord", "i-ds", "Discord"],
      ["vk", "i-vk", "ВКонтакте"],
      ["youtube", "i-yt", "YouTube"],
      ["github", "i-gh", "GitHub"],
    ];
    socials.innerHTML = map
      .filter(([key]) => safeUrl(s.socials?.[key]))
      .map(([key, iconName, label]) => {
        const url = safeUrl(s.socials[key]);
        return `<a href="${attr(url)}" target="_blank" rel="noopener noreferrer" aria-label="${attr(label)}" title="${attr(label)}">${ui.icon(iconName)}</a>`;
      })
      .join("");
  }

  // Кастомные стили из админки
  let style = document.getElementById("rp-custom-css");
  if (!style) {
    style = document.createElement("style");
    style.id = "rp-custom-css";
    document.head.append(style);
  }
  style.textContent = s.customCss || "";
  if (typeof syncHeaderOffset === "function") setTimeout(syncHeaderOffset, 30);
}

function buildNav() {
  const s = settings();
  const items = (s.nav || []).filter((item) => item.enabled !== false);
  mainNav.innerHTML = items
    .map((item) => `<a href="${attr(item.href)}" data-href="${attr(item.href)}">${esc(item.label)}</a>`)
    .join("");

  const footerLinks = document.getElementById("footerLinks");
  if (footerLinks) {
    footerLinks.innerHTML = items
      .map((item) => `<li><a href="${attr(item.href)}">${esc(item.label)}</a></li>`)
      .join("");
  }
}

function markActiveNav(path) {
  $$("[data-href]").forEach((link) => link.removeAttribute("aria-current"));
  $$("[data-nav]").forEach((link) => link.removeAttribute("aria-current"));

  const candidates = $$("[data-href]");
  const exact = candidates.find((link) => (link.dataset.href || "").replace(/^#/, "").split("?")[0] === path);
  if (exact) exact.setAttribute("aria-current", "page");

  const bottomKey = path === "/" ? "home" : path.startsWith("/catalog") ? "catalog" : path.startsWith("/favorites") ? "favorites" : path.startsWith("/admin") ? "admin" : "";
  if (bottomKey) {
    const bottomLink = document.querySelector(`[data-nav="${bottomKey}"]`);
    if (bottomLink) bottomLink.setAttribute("aria-current", "page");
  }
}

function syncHeaderOffset() {
  const height = siteHeader ? siteHeader.getBoundingClientRect().height : 68;
  document.documentElement.style.setProperty("--header-offset", `${Math.round(height)}px`);
}

function setTitle(title) {
  document.title = title ? `${title} — ${settings().siteName}` : `${settings().siteName} — ${settings().tagline}`;
}

/* ---------- Глобальные обработчики ---------- */
function bindGlobalUI() {
  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    prefs = store.updatePrefs({ theme: next });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === "light" ? "#f6f7fb" : "#07070c";
  });

  window.addEventListener("load", syncHeaderOffset);
  if (document.fonts?.ready) document.fonts.ready.then(syncHeaderOffset).catch(() => {});
  window.addEventListener("resize", debounce(syncHeaderOffset, 150));
  window.addEventListener("orientationchange", () => setTimeout(syncHeaderOffset, 250));

  navToggle?.addEventListener("click", () => {
    const open = headerInner.classList.toggle("is-nav-open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    goCatalog(searchInput.value.trim());
    searchInput.blur();
  });

  const liveSearch = debounce((value) => {
    if (typeof searchHandler === "function") searchHandler(value);
  }, 180);
  searchInput?.addEventListener("input", () => liveSearch(searchInput.value.trim()));

  // Избранное (делегирование)
  document.addEventListener("click", (event) => {
    const favBtn = event.target.closest("[data-fav]");
    if (favBtn) {
      event.preventDefault();
      const id = favBtn.dataset.fav;
      const added = store.toggleFavorite(id);
      $$(`[data-fav="${CSS.escape(id)}"]`).forEach((btn) => {
        btn.classList.toggle("is-on", added);
        btn.setAttribute("aria-pressed", String(added));
        const label = btn.querySelector(".fav-label");
        if (label) label.textContent = added ? "В избранном" : "В избранное";
      });
      ui.toast(added ? "Добавлено в избранное" : "Удалено из избранного", added ? "ok" : "info");
      if (location.hash.startsWith("#/favorites")) render();
      return;
    }

    const shareBtn = event.target.closest("[data-share]");
    if (shareBtn) {
      event.preventDefault();
      shareLink(shareBtn.dataset.share || document.title);
    }
  });

  // Ссылка «к содержимому» не должна менять маршрут
  document.getElementById("skipLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    view.focus();
    view.scrollIntoView({ block: "start" });
  });

  // Горячие клавиши
  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
    if (event.key === "/" && !typing) {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
    if (event.key === "Escape" && document.activeElement === searchInput) {
      searchInput.value = "";
      searchInput.blur();
      if (typeof searchHandler === "function") searchHandler("");
    }
  });

  // Закрываем меню после перехода
  window.addEventListener("hashchange", () => {
    headerInner.classList.remove("is-nav-open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
}

function goCatalog(query) {
  const q = String(query || "").trim();
  location.hash = q ? `#/catalog?q=${encodeURIComponent(q)}` : "#/catalog";
}

async function shareLink(title) {
  const url = location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch { /* пользователь отменил */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    ui.toast("Ссылка скопирована", "ok");
  } catch {
    ui.toast("Не удалось скопировать ссылку", "err");
  }
}

/* =======================================================================
   Роутер
   ======================================================================= */
async function render() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [pathRaw, queryRaw] = raw.split("?");
  const path = pathRaw.replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(queryRaw || "");
  const segments = path.split("/").filter(Boolean);

  searchHandler = null;
  markActiveNav(path);
  view.innerHTML = "";
  const scrollTop = lastRenderedPath !== path;
  lastRenderedPath = path;

  try {
    if (path === "/" || path === "") {
      homeView();
    } else if (segments[0] === "catalog") {
      catalogView(query);
    } else if (segments[0] === "anime" && segments[1]) {
      animeView(decodeURIComponent(segments[1]));
    } else if (segments[0] === "watch" && segments[1]) {
      watchView(decodeURIComponent(segments[1]), segments[2] ? decodeURIComponent(segments[2]) : "");
    } else if (segments[0] === "favorites") {
      favoritesView();
    } else if (segments[0] === "about") {
      aboutView();
    } else if (segments[0] === "admin") {
      await adminView(segments.slice(1));
    } else {
      notFoundView();
    }
  } catch (error) {
    console.error(error);
    view.innerHTML = `<div class="container page-head"><h1>Что-то сломалось</h1>
      <p>${esc(error?.message || "Неизвестная ошибка")}</p>
      <p><a class="btn" href="#/">На главную</a></p></div>`;
  }

  if (scrollTop) window.scrollTo(0, 0);
}

/* =======================================================================
   Главная
   ======================================================================= */
function heroHTML(anime) {
  const episode = firstEpisodeForContinue(anime);
  const watch = episode ? store.watchHref(anime, episode) : `#/anime/${anime.id}`;
  return `<section class="hero" id="hero" style="--h:${hueFrom(anime.title)}">
    <div class="hero-bg"></div>
    <div class="hero-inner">
      <span class="eyebrow">Выбор партии</span>
      <h1 class="hero-title">${esc(anime.title)}</h1>
      <div class="hero-meta">${ui.metaChips(anime)}</div>
      <p class="hero-sub">${esc(anime.description || "Описание пока не добавлено.")}</p>
      <div class="hero-actions">
        <a class="btn" href="${attr(watch)}">${ui.icon("play")} ${episode ? "Смотреть" : "Подробнее"}</a>
        <a class="btn btn-ghost" href="#/anime/${attr(anime.id)}">О сериале</a>
      </div>
    </div>
    <div class="hero-poster">
      <a href="#/anime/${attr(anime.id)}" aria-label="${attr(anime.title)}">
        ${ui.posterInner(anime)}
      </a>
    </div>
  </section>`;
}

function rowHTML(title, list, opts = {}) {
  if (!list.length) return "";
  return `<section class="section">
    <div class="section-head">
      <h2>${esc(title)}</h2>
      ${opts.href ? `<a class="link" href="${attr(opts.href)}">Все ${ui.icon("chevron-right")}</a>` : ""}
    </div>
    ${opts.layout === "grid"
      ? `<div class="grid-cards">${list.map((a) => ui.cardHTML(a, opts)).join("")}</div>`
      : `<div class="row-scroller">${list.map((a) => ui.cardHTML(a, opts)).join("")}</div>`}
  </section>`;
}

function firstEpisodeForContinue(anime) {
  const history = store.getHistoryItem(anime.id);
  if (history) {
    const ep = store.findEpisode(anime, history.episodeId);
    if (ep) return ep;
  }
  return store.animeEpisodes(anime)[0] || null;
}

function pickFeatured(list) {
  const s = settings();
  if (!list.length) return null;
  if (s.heroMode === "newest") {
    return [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  }
  const featured = list.filter((a) => a.featured);
  const pool = featured.length ? featured : list;
  return [...pool].sort((a, b) => b.rating - a.rating)[0];
}

function homeView() {
  const published = store.publicAnime();
  setTitle("");

  if (!published.length) {
    view.innerHTML = `<div class="container">
      <div class="page-head">
        <span class="eyebrow">${esc(settings().siteName)}</span>
        <h1>${esc(settings().siteName)}</h1>
        <p>Каталог пока пуст. Откройте админ-панель и добавьте первое аниме.</p>
      </div>
      ${ui.emptyHTML({
        iconName: "sparkles",
        title: "Здесь появится аниме",
        text: "Добавьте записи через админ-панель: название, постер, описание, эпизоды и код плеера.",
        action: `<a class="btn" href="#/admin">${ui.icon("shield")} Открыть админ-панель</a>`,
      })}
    </div>`;
    return;
  }

  const featured = pickFeatured(published);
  const history = store.getPrefs().history
    .map((item) => {
      const anime = published.find((a) => a.id === item.animeId);
      if (!anime) return null;
      const episode = store.findEpisode(anime, item.episodeId) || store.animeEpisodes(anime)[0];
      return { anime, episode, progress: item.progress || 0.02 };
    })
    .filter((item) => item && item.episode);

  const newest = [...published].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 14);
  const topRated = [...published].filter((a) => a.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, 14);
  const ongoing = published.filter((a) => a.status === "ongoing").slice(0, 14);

  const genreSections = [...store.genreCounts().entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([genre]) => ({
      genre,
      list: published.filter((a) => a.genres.includes(genre)).slice(0, 14),
    }));

  view.innerHTML = `<div class="container">
    ${heroHTML(featured)}
    ${settings().continueWatching && history.length
      ? `<section class="section">
          <div class="section-head"><h2>Продолжить просмотр</h2></div>
          <div class="row-scroller">
            ${history.map((h) => ui.cardHTML(h.anime, {
              progress: h.progress,
              href: `#/watch/${h.anime.id}/${h.episode.id}`,
            })).join("")}
          </div>
        </section>`
      : ""}
    ${rowHTML("Новинки каталога", newest, { href: "#/catalog?sort=new" })}
    ${topRated.length ? rowHTML("Топ рейтинга", topRated, { href: "#/catalog?sort=rating" }) : ""}
    ${ongoing.length ? rowHTML("Онгоинги", ongoing, { href: "#/catalog?status=ongoing" }) : ""}
    ${genreSections.map((s) => rowHTML(s.genre, s.list, { href: `#/catalog?genre=${encodeURIComponent(s.genre)}` })).join("")}
    <section class="section">
      <div class="panel" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between">
        <div>
          <span class="eyebrow">Команда</span>
          <h2 style="margin-top:8px">Хотите добавить своё аниме?</h2>
          <p class="muted small" style="margin-top:6px;max-width:60ch">Всё управление — в админ-панели: каталог, эпизоды, плееры, жанры, цвета и тексты сайта. Публикация — через файл <code>data/catalog.json</code>.</p>
        </div>
        <a class="btn" href="#/admin">${ui.icon("shield")} В админ-панель</a>
      </div>
    </section>
  </div>`;

  const hero = document.getElementById("hero");
  const banner = safeUrl(featured.banner);
  if (hero && banner) hero.style.setProperty("--hero-img", `url("${banner}")`);

}

/* =======================================================================
   Каталог
   ======================================================================= */
function catalogView(query) {
  const state = {
    q: query.get("q") || "",
    genre: query.get("genre") || "all",
    year: query.get("year") || "all",
    status: query.get("status") || "all",
    sort: query.get("sort") || "new",
  };

  const published = store.publicAnime();
  const years = [...new Set(published.map((a) => a.year))].sort((a, b) => b - a);
  const genres = [...store.genreCounts().entries()].filter(([, n]) => n > 0).map(([g, n]) => ({ g, n }));
  const total = published.length;

  setTitle("Каталог");

  view.innerHTML = `<div class="container">
    <div class="page-head">
      <span class="eyebrow">Каталог</span>
      <h1>Все аниме</h1>
      <p>${total} ${total === 1 ? "тайтл" : "тайтлов"} в каталоге. Фильтруйте по жанру, году и статусу.</p>
    </div>

    <div class="filter-bar" id="filters">
      <button class="chip" type="button" data-genre="all">Все жанры</button>
      ${genres.map(({ g, n }) => `<button class="chip" type="button" data-genre="${attr(g)}">${esc(g)} <span class="muted">${n}</span></button>`).join("")}
      <span style="flex:1 1 auto"></span>
      <select id="yearSelect" aria-label="Год">
        <option value="all">Любой год</option>
        ${years.map((y) => `<option value="${y}">${y}</option>`).join("")}
      </select>
      <select id="statusSelect" aria-label="Статус">
        <option value="all">Любой статус</option>
        <option value="ongoing">Онгоинг</option>
        <option value="released">Завершён</option>
        <option value="announced">Анонс</option>
        <option value="hiatus">Перерыв</option>
      </select>
      <select id="sortSelect" aria-label="Сортировка">
        <option value="new">Сначала новые</option>
        <option value="rating">По рейтингу</option>
        <option value="title">По названию</option>
        <option value="year">По году</option>
      </select>
    </div>

    <div class="row-between" style="margin:18px 0 12px">
      <h2 style="font-size:1rem" class="muted" id="resultCount"></h2>
      ${state.q ? `<button class="chip" type="button" id="clearSearch">Сбросить поиск: «${esc(state.q)}» ✕</button>` : ""}
    </div>

    <div id="catalogResults"></div>
  </div>`;

  const results = document.getElementById("catalogResults");
  const countEl = document.getElementById("resultCount");
  const yearSelect = document.getElementById("yearSelect");
  const statusSelect = document.getElementById("statusSelect");
  const sortSelect = document.getElementById("sortSelect");
  yearSelect.value = state.year;
  statusSelect.value = state.status;
  sortSelect.value = state.sort;

  $$("[data-genre]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.genre === state.genre));
  });

  function syncHash() {
    const qs = new URLSearchParams();
    if (state.q) qs.set("q", state.q);
    if (state.genre !== "all") qs.set("genre", state.genre);
    if (state.year !== "all") qs.set("year", state.year);
    if (state.status !== "all") qs.set("status", state.status);
    if (state.sort !== "new") qs.set("sort", state.sort);
    const next = `#/catalog${qs.toString() ? `?${qs}` : ""}`;
    history.replaceState(null, "", next);
  }

  function applyFilters() {
    let list = [...published];
    const q = state.q.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        a.title.toLowerCase().includes(q) ||
        a.originalTitle.toLowerCase().includes(q) ||
        a.genres.some((g) => g.toLowerCase().includes(q)) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (state.genre !== "all") list = list.filter((a) => a.genres.includes(state.genre));
    if (state.year !== "all") list = list.filter((a) => String(a.year) === state.year);
    if (state.status !== "all") list = list.filter((a) => a.status === state.status);

    switch (state.sort) {
      case "rating": list.sort((a, b) => b.rating - a.rating); break;
      case "title": list.sort((a, b) => a.title.localeCompare(b.title, "ru")); break;
      case "year": list.sort((a, b) => b.year - a.year); break;
      default: list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return list;
  }

  function paint() {
    const list = applyFilters();
    countEl.textContent = list.length
      ? `Найдено: ${list.length} ${list.length === 1 ? "тайтл" : "тайтлов"}`
      : "";
    results.innerHTML = list.length
      ? `<div class="grid-cards">${list.map((a) => ui.cardHTML(a)).join("")}</div>`
      : ui.emptyHTML({
          iconName: "search",
          title: "Ничего не найдено",
          text: "Измените фильтры или поисковый запрос.",
          action: `<button class="btn btn-ghost btn-sm" type="button" id="resetFilters">Сбросить фильтры</button>`,
        });
    const reset = document.getElementById("resetFilters");
    if (reset) {
      reset.addEventListener("click", () => {
        Object.assign(state, { q: "", genre: "all", year: "all", status: "all", sort: "new" });
        yearSelect.value = "all";
        statusSelect.value = "all";
        sortSelect.value = "new";
        $$("[data-genre]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.genre === "all")));
        syncHash();
        paint();
      });
    }
  }

  $$("[data-genre]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.genre = btn.dataset.genre;
      $$("[data-genre]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      syncHash();
      paint();
    });
  });
  yearSelect.addEventListener("change", () => { state.year = yearSelect.value; syncHash(); paint(); });
  statusSelect.addEventListener("change", () => { state.status = statusSelect.value; syncHash(); paint(); });
  sortSelect.addEventListener("change", () => { state.sort = sortSelect.value; syncHash(); paint(); });
  document.getElementById("clearSearch")?.addEventListener("click", () => {
    state.q = "";
    if (searchInput) searchInput.value = "";
    syncHash();
    paint();
  });

  searchHandler = (value) => {
    state.q = value;
    syncHash();
    paint();
  };

  if (searchInput) searchInput.value = state.q;
  paint();
}

/* =======================================================================
   Страница аниме
   ======================================================================= */
function animeView(id) {
  const anime = store.getAnime(id);
  if (!anime || (!anime.published && !store.isAdmin())) {
    notFoundView("Это аниме не найдено в каталоге.");
    return;
  }
  setTitle(anime.title);

  const episodes = store.animeEpisodes(anime);
  const history = store.getHistoryItem(anime.id);
  const continueEp = history ? store.findEpisode(anime, history.episodeId) : null;
  const startEp = continueEp || episodes[0];
  const fav = store.isFavorite(anime.id);
  const related = store.publicAnime()
    .filter((a) => a.id !== anime.id && a.genres.some((g) => anime.genres.includes(g)))
    .slice(0, 8);

  view.innerHTML = `<div class="anime-hero" id="animeHero">
    <div class="anime-hero-bg"></div>
    <div class="container">
      <div class="anime-layout">
        <div class="anime-poster" style="--h:${hueFrom(anime.title)}">${ui.posterInner(anime)}</div>

        <div class="anime-head">
          <span class="eyebrow">${anime.status === "ongoing" ? "Онгоинг" : statusLabel(anime.status)}${anime.year ? ` · ${anime.year}` : ""}</span>
          <h1 class="anime-title" style="margin-top:8px">${esc(anime.title)}</h1>
          ${anime.originalTitle ? `<p class="anime-original">${esc(anime.originalTitle)}</p>` : ""}

          <div class="anime-meta">${ui.metaChips(anime)}</div>

          <div class="anime-actions">
            ${startEp
              ? `<a class="btn" href="${attr(store.watchHref(anime, startEp))}">${ui.icon("play")} ${continueEp ? "Продолжить" : "Смотреть"} — ${esc(String(startEp.number))} серия</a>`
              : `<span class="chip">Серии скоро появятся</span>`}
            <button class="btn btn-ghost${fav ? " is-on" : ""}" type="button" data-fav="${attr(anime.id)}" aria-pressed="${fav}">
              ${ui.icon("heart")} <span class="fav-label">${fav ? "В избранном" : "В избранное"}</span>
            </button>
            <button class="btn btn-ghost" type="button" data-share="${attr(anime.title)}">
              ${ui.icon("external")} Поделиться
            </button>
          </div>

          <div class="anime-stats">
            <div class="stat"><b>${anime.rating ? anime.rating.toFixed(1) : "—"}</b><span>Рейтинг</span></div>
            <div class="stat"><b>${episodes.length}</b><span>${episodes.length === 1 ? "эпизод" : "эпизодов"}</span></div>
            <div class="stat"><b>${esc(String(anime.year))}</b><span>Год</span></div>
            <div class="stat"><b>${esc(statusLabel(anime.status))}</b><span>Статус</span></div>
          </div>

          <div class="section" style="margin-top:22px">
            <h2 style="font-size:clamp(16px,2vw,20px);margin-bottom:8px">Описание</h2>
            <div class="anime-description" id="animeDescription">
              <div class="prose is-clamped">
                ${(anime.description || "Описание пока не добавлено.").split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")}
              </div>
            </div>
            ${(anime.description || "").length > 420 ? `<button class="btn btn-ghost btn-sm" type="button" id="descToggle" style="margin-top:10px">Читать полностью</button>` : ""}
          </div>

          <dl class="detail-grid">
            ${anime.studio ? `<div class="detail-item"><dt>Студия</dt><dd>${esc(anime.studio)}</dd></div>` : ""}
            ${anime.director ? `<div class="detail-item"><dt>Режиссёр</dt><dd>${esc(anime.director)}</dd></div>` : ""}
            <div class="detail-item"><dt>Страна</dt><dd>${esc(anime.country || "—")}</dd></div>
            <div class="detail-item"><dt>Жанры</dt><dd>${anime.genres.length ? esc(anime.genres.join(", ")) : "—"}</dd></div>
            <div class="detail-item"><dt>Добавлено</dt><dd>${esc(formatDate(anime.createdAt))}</dd></div>
            <div class="detail-item"><dt>ID</dt><dd>${esc(anime.id)}</dd></div>
          </dl>
        </div>
      </div>

      <section class="section" id="episodesSection">
        <div class="section-head">
          <h2>Эпизоды</h2>
          <span class="chip">${episodes.length} ${episodes.length === 1 ? "серия" : "серий"}</span>
        </div>
        ${episodes.length ? `<div class="episodes">
          ${episodes.map((ep) => {
            const isWatched = history && history.episodeId === ep.id && (history.progress || 0) > 0.9;
            const players = ep.players.map((p) => p.name).filter(Boolean).join(" · ");
            return `<div class="episode-row${isWatched ? " is-watched" : ""}">
              <span class="episode-num">${esc(String(ep.number))}</span>
              <div class="episode-main">
                <b>${esc(ep.title || `Серия ${ep.number}`)}</b>
                <small>${[players, ep.duration, ep.date ? formatDate(ep.date) : ""].filter(Boolean).map(esc).join(" · ")}</small>
              </div>
              <a class="btn btn-soft btn-sm" href="${attr(store.watchHref(anime, ep))}">${ui.icon("play")} Смотреть</a>
            </div>`;
          }).join("")}
        </div>` : ui.emptyHTML({ iconName: "tv", title: "Серий пока нет", text: "Эпизоды и плееры добавляются в админ-панели." })}
      </section>

      ${related.length ? `<section class="section">
        <div class="section-head"><h2>Похожее</h2><a class="link" href="#/catalog?genre=${encodeURIComponent(anime.genres[0] || "")}">Ещё ${ui.icon("chevron-right")}</a></div>
        <div class="row-scroller">${related.map((a) => ui.cardHTML(a)).join("")}</div>
      </section>` : ""}
    </div>
  </div>`;

  const heroBg = document.getElementById("animeHero")?.querySelector(".anime-hero-bg");
  const banner = safeUrl(anime.banner) || safeUrl(anime.poster);
  if (heroBg && banner) heroBg.style.setProperty("--banner", `url("${banner}")`);

  const toggle = document.getElementById("descToggle");
  const prose = document.querySelector("#animeDescription .prose");
  toggle?.addEventListener("click", () => {
    const clamped = prose.classList.toggle("is-clamped");
    toggle.textContent = clamped ? "Читать полностью" : "Свернуть";
  });
}

/* =======================================================================
   Просмотр
   ======================================================================= */
function watchView(id, episodeKey) {
  const anime = store.getAnime(id);
  if (!anime) {
    notFoundView("Аниме не найдено.");
    return;
  }
  const episodes = store.animeEpisodes(anime);
  if (!episodes.length) {
    setTitle(anime.title);
    view.innerHTML = `<div class="container page-head">
      <h1>${esc(anime.title)}</h1>
      <p>У этого тайтла пока нет эпизодов.</p>
      <p><a class="btn" href="#/anime/${attr(anime.id)}">На страницу аниме</a></p>
    </div>`;
    return;
  }

  const query = new URLSearchParams(location.hash.split("?")[1] || "");
  const episode = store.findEpisode(anime, episodeKey) || episodes[0];
  const playerIndex = Math.max(0, Math.min(episode.players.length - 1, Number(query.get("p")) || 0));
  const player = episode.players[playerIndex] || episode.players[0];

  setTitle(`${anime.title} — ${episode.title || `серия ${episode.number}`}`);

  const index = episodes.findIndex((ep) => ep.id === episode.id);
  const prev = episodes[index - 1];
  const next = episodes[index + 1];

  view.innerHTML = `<div class="container watch-layout">
    <div class="player-shell">
      <div class="player-frame" id="playerMount"></div>

      <div class="player-bar">
        <label class="visually-hidden" for="episodeSelect">Серия</label>
        <select id="episodeSelect" class="grow">
          ${episodes.map((ep) => `<option value="${attr(ep.id)}"${ep.id === episode.id ? " selected" : ""}>Серия ${esc(String(ep.number))}${ep.title ? ` — ${esc(ep.title)}` : ""}</option>`).join("")}
        </select>
        <label class="visually-hidden" for="playerSelect">Плеер</label>
        <select id="playerSelect" class="grow">
          ${episode.players.map((p, i) => `<option value="${i}"${i === playerIndex ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm${store.isFavorite(anime.id) ? " is-on" : ""}" type="button" data-fav="${attr(anime.id)}">
          ${ui.icon("heart")} <span class="fav-label">${store.isFavorite(anime.id) ? "В избранном" : "В избранное"}</span>
        </button>
      </div>

      <div class="row-between">
        <div style="min-width:0">
          <h1 class="watch-title">${esc(episode.title || `Серия ${episode.number}`)}</h1>
          <p class="watch-sub">
            <a href="#/anime/${attr(anime.id)}" style="font-weight:700;color:var(--text)">${esc(anime.title)}</a>
            <span>·</span><span>${esc(anime.year)}</span>
            ${episode.duration ? `<span>·</span><span>${esc(episode.duration)}</span>` : ""}
            ${episode.date ? `<span>·</span><span>${esc(formatDate(episode.date))}</span>` : ""}
            <span>·</span><span>${esc(player?.name || "")}</span>
          </p>
        </div>
        <div class="nav-pager">
          ${prev ? `<a class="btn btn-ghost btn-sm" href="${attr(store.watchHref(anime, prev))}">${ui.icon("chevron-left")} Пред.</a>` : ""}
          ${next ? `<a class="btn btn-sm" href="${attr(store.watchHref(anime, next))}">След. ${ui.icon("chevron-right")}</a>` : ""}
        </div>
      </div>

      ${settings().playerNote ? `<div class="notice">${ui.icon("info")}<div>${esc(settings().playerNote)}</div></div>` : ""}
    </div>

    <aside class="watch-side">
      <div class="watch-side-head">
        <h2>Серии</h2>
        <span>${pluralEpisodes(episodes.length)}</span>
      </div>
      <div class="episode-list">
        ${episodes.map((ep) => `<a class="episode-chip${ep.id === episode.id ? " is-active" : ""}" href="${attr(store.watchHref(anime, ep))}">
          <span class="n">${esc(String(ep.number))}</span>
          <span style="min-width:0"><b>${esc(ep.title || `Серия ${ep.number}`)}</b><small>${ep.players.length ? esc(ep.players.map((p) => p.name).join(" · ")) : "плеер не задан"}</small></span>
        </a>`).join("")}
      </div>
    </aside>
  </div>`;

  const mount = document.getElementById("playerMount");

  function mountCurrent(selectedPlayer) {
    ui.mountPlayer(mount, selectedPlayer, {
      anime,
      onProgress: (ratio) => {
        store.recordHistory(anime.id, episode.id, { progress: ratio });
      },
    });
  }

  mountCurrent(player);
  const known = store.getHistoryItem(anime.id);
  store.recordHistory(anime.id, episode.id, {
    progress: known && known.episodeId === episode.id ? known.progress || 0 : 0,
  });

  document.getElementById("episodeSelect")?.addEventListener("change", (event) => {
    const target = store.findEpisode(anime, event.target.value);
    if (target) location.hash = store.watchHref(anime, target);
  });

  document.getElementById("playerSelect")?.addEventListener("change", (event) => {
    const i = Number(event.target.value) || 0;
    const chosen = episode.players[i];
    if (!chosen) return;
    const nextHash = `${store.watchHref(anime, episode)}?p=${i}`;
    history.replaceState(null, "", nextHash);
    mountCurrent(chosen);
    ui.toast(`Плеер: ${chosen.name}`, "info");
  });
}

/* =======================================================================
   Избранное / О сайте / 404
   ======================================================================= */
function favoritesView() {
  setTitle("Избранное");
  const ids = store.getPrefs().favorites;
  const list = ids.map((id) => store.getAnime(id)).filter((a) => a && a.published);

  view.innerHTML = `<div class="container">
    <div class="page-head">
      <span class="eyebrow">Коллекция</span>
      <h1>Избранное</h1>
      <p>Список хранится в этом браузере. ${list.length ? `Сохранено: ${list.length}.` : ""}</p>
    </div>
    ${list.length
      ? `<div class="grid-cards">${list.map((a) => ui.cardHTML(a)).join("")}</div>`
      : ui.emptyHTML({
          iconName: "heart",
          title: "Пока пусто",
          text: "Нажмите на сердечко у аниме, чтобы добавить его в избранное.",
          action: `<a class="btn" href="#/catalog">Перейти в каталог</a>`,
        })}
  </div>`;
}

function aboutView() {
  const s = settings();
  setTitle("О проекте");
  const s1 = store.getState();
  view.innerHTML = `<div class="container">
    <div class="page-head">
      <span class="eyebrow">Команда «${esc(s.siteName)}»</span>
      <h1>${esc(s.aboutTitle || "О проекте")}</h1>
      <p>${esc(s.aboutText || s.description)}</p>
    </div>

    <div class="section" style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))">
      <div class="panel">
        <h2 style="font-size:1.05rem;margin-bottom:8px">Что это</h2>
        <p class="muted small" style="line-height:1.65">Статический аниме-портал: каталог, эпизоды и плееры. Работает на GitHub Pages без сервера и базы данных — все данные лежат в <code>data/catalog.json</code>.</p>
      </div>
      <div class="panel">
        <h2 style="font-size:1.05rem;margin-bottom:8px">Админ-панель</h2>
        <p class="muted small" style="line-height:1.65">Пароль по умолчанию — <code>${esc(store.DEFAULT_PASSWORD)}</code>. Смените его в разделе «Публикация». Правки хранятся локально, для публикации скачайте JSON и замените им <code>data/catalog.json</code> в репозитории.</p>
      </div>
      <div class="panel">
        <h2 style="font-size:1.05rem;margin-bottom:8px">Состояние</h2>
        <p class="muted small" style="line-height:1.65">Данные: <b>${s1.source === "draft" ? "локальный черновик админки" : "data/catalog.json"}</b>.<br />Тайтлов: <b>${(catalog?.anime || []).length}</b>.<br />Обновлено: <b>${esc(formatDate(catalog?.updatedAt) || "—")}</b>.</p>
      </div>
    </div>

    <div class="section panel">
      <h2 style="font-size:1.05rem;margin-bottom:10px">Правовая заметка</h2>
      <p class="muted small" style="line-height:1.65">Сайт не хранит видеофайлы: плееры подключаются кодом вставки на стороне администратора. Права на произведения принадлежат их авторам и правообладателям. Добавляйте только тот контент, который вы вправе распространять.</p>
      ${s.socials?.telegram ? `<p class="small" style="margin-top:10px"><a class="btn btn-ghost btn-sm" href="${attr(safeUrl(s.socials.telegram))}" target="_blank" rel="noopener">Написать в Telegram</a></p>` : ""}
    </div>
  </div>`;
}

function notFoundView(message = "Проверьте адрес или вернитесь в каталог.") {
  setTitle("Страница не найдена");
  view.innerHTML = `<div class="container">
    <div class="page-head">
      <span class="eyebrow">404</span>
      <h1>Страница не найдена</h1>
      <p>${esc(message)}</p>
    </div>
    ${ui.emptyHTML({
      iconName: "search",
      title: "Такой страницы нет",
      text: "Возможно, тайтл переименовали или удалили.",
      action: `<a class="btn" href="#/catalog">В каталог</a>`,
    })}
  </div>`;
}

/* =======================================================================
   Админка (подгружается отдельным модулем)
   ======================================================================= */
async function adminView(segments) {
  setTitle("Админ-панель");
  try {
    const mod = await import("./admin.js");
    await mod.renderAdmin({
      mount: view,
      segments,
      catalog,
      refresh: async () => {
        catalog = store.getCatalog();
        applySettings();
        buildNav();
        render();
      },
    });
  } catch (error) {
    console.error(error);
    view.innerHTML = `<div class="container page-head"><h1>Не удалось загрузить админ-панель</h1>
      <p>${esc(error?.message || "")}</p><a class="btn" href="#/">На главную</a></div>`;
  }
}

boot();
