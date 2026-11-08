/* «Рабочая партия» — точка входа: роутер, страницы, тема, поиск. */

import * as store from "./store.js";
import * as ui from "./ui.js";
import { applyCachedPosters, getAnimeDetails, getShikimoriBatch, posterUrlById } from "./shikimori.js";
import * as sources from "./sources.js";
import {
  $, $$, attr, debounce, esc, formatDate, hueFrom, matchesSearch, pluralEpisodes, safeUrl, statusLabel,
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
let heroTimer = null;
let heroIndex = 0; // текущий слайд — переживает перерисовку
let heroAnimeId = ""; // id тайтла на текущем слайде
let heroController = null;

/* =======================================================================
   Инициализация
   ======================================================================= */
async function boot() {
  catalog = await store.loadCatalog();
  applyCachedPosters(catalog);
  prefs = store.getPrefs();
  applySettings();
  buildNav();
  bindGlobalUI();
  syncHeaderOffset();
  initHeaderScroll();

  if (!location.hash) {
    history.replaceState(null, "", "#/");
  }
  render();
  window.addEventListener("hashchange", render);
  view.addEventListener("click", (event) => {
    if (event.target.closest("[data-auto-retry]")) loadAutoCatalog(true);
  });

  if (store.getState().loadError) {
    ui.toast("Каталог data/catalog.json не загружен — открыт пустой проект", "err");
  }

  loadAutoCatalog();
}

/* =======================================================================
   Авто-каталог Kodik: всё, что залито в плееры нужной озвучки,
   появляется на сайте само (кэш 6 часов, ничего не публикуется в git)
   ======================================================================= */
const AUTO_KEY = "rp.auto.v6";
const AUTO_TTL = 6 * 60 * 60 * 1000;
let autoLoaded = false;
/* idle | loading | done | empty | error | off — состояние авто-каталога */
let autoStatus = "idle";
let autoError = "";

function readAutoCache(stale = false) {
  try {
    const raw = window.localStorage.getItem(AUTO_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.entries) || !data.entries.length) return null;
    if (!stale && Date.now() - Number(data.savedAt || 0) > AUTO_TTL) return null;
    return data.entries;
  } catch {
    return null;
  }
}

/* ID озвучки в Kodik запоминаем: без этого при каждом открытии нужен /translations */
const TR_KEY = "rp.kodik-tr.v1";
const TR_TTL = 7 * 24 * 60 * 60 * 1000;

function readVoiceCache(filter) {
  try {
    const data = JSON.parse(window.localStorage.getItem(TR_KEY) || "null");
    if (!data || data.filter !== filter || !data.id) return null;
    if (Date.now() - Number(data.savedAt || 0) > TR_TTL) return null;
    return { id: data.id, title: data.title || filter };
  } catch {
    return null;
  }
}

function writeVoiceCache(filter, voice) {
  try {
    window.localStorage.setItem(TR_KEY, JSON.stringify({ filter, id: voice.id, title: voice.title, savedAt: Date.now() }));
  } catch {
    /* приватный режим — не страшно */
  }
}

function writeAutoCache(entries) {
  try {
    window.localStorage.setItem(AUTO_KEY, JSON.stringify({ savedAt: Date.now(), entries }));
  } catch {
    // нет места — просто не кэшируем
  }
}

async function loadAutoCatalog(force = false) {
  const s = settings();
  if (autoStatus === "loading") return;
  if (!s.kodikAuto) {
    autoStatus = "off";
    return;
  }
  if (autoLoaded && !force) return;

  const keys = store.getKeys();
  if (!keys.kodikToken) {
    autoStatus = "error";
    autoError = "Не задан токен Kodik";
    return;
  }

  if (!force) {
    const cached = readAutoCache();
    if (cached) {
      autoStatus = "done";
      mergeAutoCatalog(cached, true);
      applyShikimoriBatch(cached).then(() => {
        writeAutoCache(cached);
        patchAutoEntries(cached);
        fillDetailsAndCvh(cached);
      });
      return;
    }
  }

  autoStatus = "loading";
  autoError = "";
  if (!store.publicAnime().length) render();

  const proxy = String(s.corsProxy || "").trim();
  const filter = String(s.kodikTranslation || "Рабочая партия").trim();
  const explicitId = String(s.kodikTranslationId || "").trim();
  try {
    let voice = explicitId ? { id: explicitId, title: filter } : readVoiceCache(filter);
    if (!voice) {
      const list = await sources.kodikTranslations({ token: keys.kodikToken, proxy });
      voice = sources.matchVoice(list, filter);
      if (!voice) {
        const hints = sources.suggestVoices(list, filter);
        autoStatus = "empty";
        autoError = hints.length
          ? `В Kodik нет озвучки «${filter}». Похожие: ${hints.join(", ")}. Впишите название точно как в Kodik или укажите её ID в «Настройках сайта».`
          : `В Kodik нет озвучки «${filter}». Проверьте название в «Настройках сайта» или укажите ID озвучки.`;
        render();
        return;
      }
      writeVoiceCache(filter, voice);
    }
    let items = await sources.kodikList({ token: keys.kodikToken, translationId: voice.id, proxy, maxPages: 3 });
    if (!items.length && explicitId) {
      /* ID мог устареть — пробуем найти озвучку по названию */
      const list = await sources.kodikTranslations({ token: keys.kodikToken, proxy });
      const fallbackVoice = sources.matchVoice(list, filter);
      if (fallbackVoice) {
        voice = fallbackVoice;
        writeVoiceCache(filter, voice);
        items = await sources.kodikList({ token: keys.kodikToken, translationId: voice.id, proxy, maxPages: 3 });
      }
    }
    const entries = sources.kodikCatalogEntries(items, { translation: voice.title });
    if (!entries.length) {
      autoStatus = "empty";
      autoError = `В озвучке «${voice.title}» пока нет тайтлов с сериями`;
      render();
      return;
    }
    /* быстрый слой: названия, оценки, постеры; подробности и CVH — в фоне */
    await applyShikimoriBatch(entries);
    writeAutoCache(entries);
    autoStatus = "done";
    mergeAutoCatalog(entries, true);
    fillDetailsAndCvh(entries);
  } catch (error) {
    autoError = error?.message || "Kodik недоступен";
    console.debug("Авто-каталог Kodik недоступен:", autoError);
    /* Kodik не ответил — показываем последний сохранённый список, а не пустой экран */
    const stale = readAutoCache(true);
    if (stale?.length) {
      autoStatus = "done";
      mergeAutoCatalog(stale, true);
      ui.toast(`Kodik не ответил (${autoError}) — показан сохранённый список`, "err");
      return;
    }
    autoStatus = "error";
    render();
  }
}

/* --- Обогащение авто-каталога --- */
const STATUS_MAP = { ongoing: "ongoing", released: "released", anons: "announced" };

/** Быстрый слой: пакетные запросы — постеры и баннеры из AniList, названия и оценки из Shikimori. */
async function applyShikimoriBatch(entries) {
  const ids = [...new Set(entries.map((entry) => entry.shikimoriId).filter(Boolean))];
  let shiki = {};
  let anilist = {};
  if (ids.length) {
    await Promise.all([
      getShikimoriBatch(ids).then((data) => { shiki = data || {}; }).catch((error) => {
        console.debug("Shikimori batch:", error?.message);
      }),
      sources.anilistBatch(ids).then((data) => { anilist = data || {}; }).catch((error) => {
        console.debug("AniList batch:", error?.message);
      }),
    ]);
  }
  entries.forEach((entry) => {
    const shot = entry.banner; // кадр из серии Kodik (запасной вариант)
    const info = shiki[entry.shikimoriId] || null;
    const al = anilist[entry.shikimoriId] || null;
    if (al) {
      entry.poster = al.posterSmall || al.poster || "";
      /* в карусели хотим кадры из серий, баннер AniList — запасной вариант */
      entry.banner = shot || al.banner || "";
      entry.malId = Number(al.malId) || entry.malId || 0;
    }
    if (info) {
      entry.title = info.title || entry.title;
      entry.originalTitle = entry.originalTitle || info.originalTitle || "";
      entry.rating = Number(info.rating) || entry.rating || 0;
      entry.year = entry.year || info.year;
      entry.status = STATUS_MAP[info.status] || entry.status || "ongoing";
      entry.kind = entry.kind || info.kind || "";
      entry.episodesAired = Number(info.episodesAired) || entry.episodesAired || 0;
      entry.totalEpisodes = Number(info.episodes) || Number(al?.episodes) || entry.totalEpisodes || 0;
      if (!entry.poster && info.poster) entry.poster = info.poster;
      if (Array.isArray(info.genres) && info.genres.length) entry.genres = info.genres;
    }
    if (al) {
      entry.rating = entry.rating || al.rating || 0;
      if (!(entry.genres || []).length) entry.genres = (al.genres || []).map((genre) => sources.genreToRu(genre));
    }
    if (!entry.poster) entry.poster = shot || "";
    if (!entry.banner && al?.banner) entry.banner = al.banner;
    if (!entry.description) entry.description = "";
  });
  return entries;
}

/**
 * Медленный слой в фоне: подробности (описание, жанры, MAL ID) из Shikimori
 * и плееры CVH для каждой серии. Результат кешируется, второй запуск мгновенный.
 */
let detailsRunning = false;

async function fillDetailsAndCvh(entries) {
  if (detailsRunning) return;
  detailsRunning = true;
  const s = settings();
  const studio = String(s.cvhTranslation || "Рабочая партия").trim();
  const pub = String(s.cvhPub || "747").trim();
  const aggr = String(s.cvhAggr || "mali").trim();
  const proxy = String(s.corsProxy || "").trim();
  const queue = [...entries];
  let changed = 0;
  let cvhTried = 0;
  let cvhOk = 0;
  let cvhError = "";

  const attachCvh = (entry) => {
    if (entry.episodes.some((episode) => (episode.players || []).some((player) => player.type === "cvh"))) return false;
    return true;
  };

  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift();
      let touched = false;
      if (!entry.description && entry.shikimoriId) {
        try {
          const info = await getAnimeDetails(entry.shikimoriId);
          if (info) {
            entry.description = info.description || "";
            entry.genres = Array.isArray(info.genres) && info.genres.length ? info.genres : (entry.genres || []);
            entry.rating = Number(info.rating) || entry.rating;
            entry.malId = Number(info.malId) || entry.malId || 0;
            entry.status = STATUS_MAP[info.status] || entry.status;
            entry.kind = entry.kind || info.kind || "";
            entry.episodesAired = Number(info.episodesAired) || entry.episodesAired || 0;
            entry.totalEpisodes = Number(info.episodes) || entry.totalEpisodes || 0;
            if (!entry.poster && info.poster) entry.poster = info.poster;
            touched = true;
          }
        } catch (error) {
          console.debug("Подробности Shikimori:", entry.shikimoriId, error?.message);
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      /* Shikimori часто отдаёт 0 серий — берём число из MyAnimeList/Kitsu */
      if (!entry.totalEpisodes) {
        try {
          const total = await sources.resolveEpisodeTotal({
            malId: entry.malId,
            title: entry.originalTitle || entry.title,
            year: entry.year,
          });
          if (total.total) { entry.totalEpisodes = total.total; touched = true; }
          if (!entry.malId && total.malId) { entry.malId = total.malId; touched = true; }
        } catch (error) {
          console.debug("Число серий:", entry.title, error?.message);
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      if (attachCvh(entry)) {
        cvhTried += 1;
        try {
          const items = await sources.cvhPlaylist({ id: entry.malId || entry.shikimoriId, pub, aggr, proxy, textProxy: false });
          const found = sources.cvhEpisodes(items, { translation: studio });
          found.forEach((episode) => {
            const url = sources.cvhPlayerUrl(episode.vkId);
            const player = { name: `CVH · ${episode.studio || studio}`, type: "cvh", url, code: "" };
            const existing = entry.episodes.find((item) => item.number === episode.number);
            if (existing) {
              const players = Array.isArray(existing.players) ? existing.players : [];
              if (players.some((item) => item.url === url)) return;
              existing.players = [player, ...players];
              if (!existing.title && episode.title) existing.title = episode.title;
            } else {
              entry.episodes.push({ number: episode.number, title: episode.title || "", date: "", duration: "", players: [player] });
            }
            touched = true;
          });
          entry.episodes.sort((a, b) => a.number - b.number);
          if (found.length) cvhOk += 1;
        } catch (error) {
          cvhError = error?.message || "ошибка";
        }
      }
      if (touched) {
        changed += 1;
        if (changed % 6 === 0) patchAutoEntries(entries);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
  } finally {
    detailsRunning = false;
  }
  if (changed) {
    writeAutoCache(entries);
    patchAutoEntries(entries);
  }
  if (cvhTried && !cvhOk) {
    ui.toast(`Плееры CVH не добавлены: ${cvhError || "сервис не ответил"}`, "err");
  }
}

/** Переносит свежие данные авто-каталога в текущий каталог (по id карточки). */
function patchAutoEntries(entries) {
  const current = store.getCatalog();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let touched = false;
  const anime = current.anime.map((item) => {
    const fresh = byId.get(item.id);
    if (!fresh) return item;
    touched = true;
    return { ...item, ...fresh, published: item.published !== false, createdAt: item.createdAt };
  });
  if (!touched) return;
  const merged = store.normalizeCatalog({ ...current, anime });
  store.setCatalog(merged);
  catalog = merged;
  render();
}

function mergeAutoCatalog(entries, rerender = false) {
  if (!Array.isArray(entries) || !entries.length) return;
  if (/^#\/admin/.test(location.hash) && !rerender) return;
  const current = store.getCatalog();
  const known = new Set();
  current.anime.forEach((anime) => {
    if (anime.shikimoriId) known.add(`s${anime.shikimoriId}`);
    known.add(`t${String(anime.title || "").toLowerCase()}`);
  });
  const fresh = entries.filter((entry) => {
    if (entry.shikimoriId && known.has(`s${entry.shikimoriId}`)) return false;
    return !known.has(`t${String(entry.title || "").toLowerCase()}`);
  });
  autoLoaded = true;
  if (!fresh.length) {
    if (rerender) render();
    return;
  }
  const merged = store.normalizeCatalog({ ...current, anime: [...current.anime, ...fresh] });
  store.setCatalog(merged);
  catalog = merged;
  render();
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
/* Подсказки под поиском в шапке: миниатюры и названия совпадений */
function initSearchSuggest() {
  if (!searchForm || !searchInput) return;
  searchForm.classList.add("has-suggest");
  let box = document.getElementById("searchSuggest");
  if (!box) {
    box = document.createElement("div");
    box.className = "search-suggest";
    box.id = "searchSuggest";
    box.hidden = true;
    searchForm.append(box);
  }

  let items = [];
  let active = -1;

  const close = () => {
    box.hidden = true;
    box.innerHTML = "";
    items = [];
    active = -1;
  };

  const render = () => {
    const query = searchInput.value.trim();
    if (query.length < 2) { close(); return; }
    items = store.publicAnime()
      .filter((anime) => matchesSearch(
        [anime.title, anime.originalTitle, ...(anime.aliases || []), ...anime.genres],
        query,
      ))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 6);
    if (!items.length) { close(); return; }
    active = 0;
    box.innerHTML = items.map((anime, index) => {
      const poster = safeUrl(anime.poster);
      const meta = [anime.year, anime.genres[0], anime.rating ? `★ ${anime.rating.toFixed(1)}` : ""]
        .filter(Boolean).join(" · ");
      return `<a class="search-suggest-item${index === 0 ? " is-active" : ""}" href="#/anime/${attr(anime.id)}" data-suggest="${index}">
        <span class="search-suggest-poster" style="--h:${hueFrom(anime.title)}">${poster ? `<img src="${attr(poster)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()" />` : ""}</span>
        <span class="search-suggest-text"><b>${esc(anime.title)}</b><small>${esc(meta)}</small></span>
      </a>`;
    }).join("");
    box.hidden = false;
  };

  const highlight = () => {
    box.querySelectorAll(".search-suggest-item").forEach((el, index) => {
      el.classList.toggle("is-active", index === active);
    });
  };

  searchInput.addEventListener("input", debounce(render, 120));
  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim().length >= 2) render();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (box.hidden) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      highlight();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(0, active - 1);
      highlight();
    } else if (event.key === "Enter" && items[active]) {
      event.preventDefault();
      const picked = items[active];
      close();
      searchInput.value = "";
      location.hash = `#/anime/${picked.id}`;
    } else if (event.key === "Escape") {
      close();
    }
  });
  box.addEventListener("click", () => {
    searchInput.value = "";
    close();
  });
  searchInput.addEventListener("blur", () => setTimeout(close, 160));
  document.addEventListener("click", (event) => {
    if (!searchForm.contains(event.target)) close();
  });
}

function bindGlobalUI() {
  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    prefs = store.updatePrefs({ theme: next });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === "light" ? "#f6f7fb" : "#07070c";
  });

  document.addEventListener("visibilitychange", () => {
    if (!heroController) return;
    if (document.hidden) heroController.stop();
    else heroController.start();
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
    // если пользователь уже перешёл на другую страницу — не перетираем её фильтр старым вводом
    if (typeof searchHandler !== "function") return;
    if (searchInput.value.trim() !== value) return;
    searchHandler(value);
  }, 180);
  searchInput?.addEventListener("input", () => liveSearch(searchInput.value.trim()));

  initSearchSuggest();

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
  clearHeroTimer();
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

  initRails();
  if (scrollTop) window.scrollTo(0, 0);
}

/* =======================================================================
   Главная
   ======================================================================= */
/** Тайтл «в работе»: у нас вышли не все серии озвучки. */
function inProduction(anime) {
  const total = Number(anime?.totalEpisodes) || 0;
  const have = (anime?.episodes || []).length;
  if (total && have) return have < total;
  if (anime?.status === "announced") return true;
  return anime?.status === "ongoing";
}

/** Сначала то, что озвучиваем сейчас, затем по году выпуска (новые выше). */
function sortFresh(list) {
  return [...list].sort((a, b) => {
    const pa = inProduction(a) ? 0 : 1;
    const pb = inProduction(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ya = Number(a.year) || 0;
    const yb = Number(b.year) || 0;
    if (ya !== yb) return yb - ya;
    return (Number(b.rating) || 0) - (Number(a.rating) || 0);
  });
}

function pickReleases(list) {
  const featured = sortFresh(list).filter((anime) => anime.featured);
  const newest = sortFresh(list);
  const pool = [...featured, ...newest, ...list];
  const seen = new Set();
  const releases = [];
  pool.forEach((anime) => {
    if (seen.has(anime.id) || releases.length >= 6) return;
    seen.add(anime.id);
    releases.push({ anime, label: anime.featured ? "Выбор партии" : "Новый релиз" });
  });
  return releases;
}

function heroSlideHTML({ anime, label }, index) {
  const episode = firstEpisodeForContinue(anime);
  const watch = episode ? store.watchHref(anime, episode) : `#/anime/${anime.id}`;
  const banner = safeUrl(anime.banner);
  const poster = safeUrl(anime.poster);
  const mediaClass = banner ? "has-banner" : poster ? "is-poster" : "is-empty";
  const mediaUrl = banner || poster;
  const media = mediaUrl
    ? `<img class="hero-media-img" src="${attr(mediaUrl)}" alt="" referrerpolicy="no-referrer"
        loading="${index === heroIndex ? "eager" : "lazy"}" decoding="async" draggable="false" onerror="this.remove()" />`
    : "";
  return `<article class="hero-slide" data-slide="${index}" data-hero-anime="${attr(anime.id)}" aria-hidden="${index !== heroIndex}">
    <div class="hero-media ${mediaClass}" style="--h:${hueFrom(anime.title)}">${media}</div>
    <div class="hero-scrim"></div>
    <div class="hero-content">
      <span class="eyebrow">${esc(label)}</span>
      <h2 class="hero-title"><a href="#/anime/${attr(anime.id)}">${esc(anime.title)}</a></h2>
      <div class="hero-meta">${ui.metaChips(anime)}</div>
      <p class="hero-sub">${esc(anime.description || "Описание пока не добавлено.")}</p>
      <div class="hero-actions">
        <a class="btn" href="${attr(watch)}">${ui.icon("play")} ${episode ? "Смотреть" : "Подробнее"}</a>
        <a class="btn btn-ghost" href="#/anime/${attr(anime.id)}">О сериале</a>
      </div>
    </div>
    ${banner && poster ? `<a class="hero-poster" href="#/anime/${attr(anime.id)}" aria-label="${attr(anime.title)}">
      ${ui.posterInner(anime)}
    </a>` : ""}
  </article>`;
}

function heroCarouselHTML(releases) {
  if (!releases.length) return "";
  const slides = releases.map(heroSlideHTML).join("");
  const dots = releases
    .map(({ anime }, i) => `<button class="hero-dot" type="button" data-hero-dot="${i}" aria-label="Релиз ${i + 1}: ${attr(anime.title)}" aria-current="${i === heroIndex}"></button>`)
    .join("");
  return `<section class="hero-carousel${releases.length < 2 ? " is-single" : ""}" id="heroCarousel" aria-roledescription="карусель" aria-label="Релизы">
    <div class="hero-track">${slides}</div>
    ${releases.length > 1 ? `
      <button class="hero-arrow prev" type="button" data-hero-prev aria-label="Предыдущий релиз">${ui.icon("chevron-left")}</button>
      <button class="hero-arrow next" type="button" data-hero-next aria-label="Следующий релиз">${ui.icon("chevron-right")}</button>
      <div class="hero-dots">${dots}</div>` : ""}
  </section>`;
}

function clearHeroTimer() {
  if (heroTimer) {
    clearInterval(heroTimer);
    heroTimer = null;
  }
  heroController = null;
}

function initHeroCarousel() {
  clearHeroTimer();
  const root = document.getElementById("heroCarousel");
  if (!root) return;
  const track = root.querySelector(".hero-track");
  const slides = $$(".hero-slide", root);
  const dots = $$("[data-hero-dot]", root);
  if (!track || slides.length < 2) return;

  /* восстанавливаем тот же тайтл, даже если порядок слайдов изменился */
  const restored = heroAnimeId ? slides.findIndex((slide) => slide.dataset.heroAnime === heroAnimeId) : -1;
  let index = restored >= 0 ? restored : Math.max(0, Math.min(slides.length - 1, Number(heroIndex) || 0));
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let suppressClick = false;

  const render = () => {
    track.style.transform = `translate3d(-${index * 100}%, 0, 0)`;
  };

  const go = (next) => {
    index = (next + slides.length) % slides.length;
    heroIndex = index;
    heroAnimeId = slides[index]?.dataset.heroAnime || heroAnimeId;
    track.style.transition = "";
    render();
    slides.forEach((slide, i) => {
      const active = i === index;
      slide.setAttribute("aria-hidden", String(!active));
      if ("inert" in slide) slide.inert = !active;
    });
    dots.forEach((dot, i) => dot.setAttribute("aria-current", String(i === index)));
  };

  const reduceMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const stop = () => clearHeroTimer();
  const start = () => {
    stop();
    if (reduceMotion || document.hidden) return;
    heroTimer = setInterval(() => go(index + 1), 7000);
  };
  const restart = () => { stop(); start(); };

  root.querySelector("[data-hero-prev]")?.addEventListener("click", () => { go(index - 1); restart(); });
  root.querySelector("[data-hero-next]")?.addEventListener("click", () => { go(index + 1); restart(); });
  dots.forEach((dot) => dot.addEventListener("click", () => { go(Number(dot.dataset.heroDot)); restart(); }));

  root.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse") stop(); });
  root.addEventListener("pointerleave", () => { if (!dragging) start(); });
  root.addEventListener("focusin", stop);
  root.addEventListener("focusout", start);

  /* Перетаскивание мышью и пальцем */
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("is-dragging");
    const width = root.clientWidth || 1;
    const threshold = Math.min(90, Math.max(28, width * 0.14));
    if (moved && Math.abs(dx) > threshold) {
      go(index + (dx < 0 ? 1 : -1));
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);
    } else {
      go(index);
    }
    dx = 0;
    moved = false;
    restart();
  };

  root.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest("button, [data-hero-dot]")) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    stop();
    track.style.transition = "none";
  });

  root.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (!moved) {
      if (Math.abs(deltaX) < 6) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) { dragging = false; track.style.transition = ""; restart(); return; }
      moved = true;
      root.classList.add("is-dragging");
    }
    dx = deltaX;
    const atEdge = (index === 0 && dx > 0) || (index === slides.length - 1 && dx < 0);
    const offset = atEdge ? dx * 0.32 : dx;
    track.style.transform = `translate3d(calc(-${index * 100}% + ${offset}px), 0, 0)`;
  });

  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);
  root.addEventListener("pointerleave", () => { if (dragging) endDrag(); });
  root.addEventListener("dragstart", (event) => event.preventDefault());
  root.addEventListener("click", (event) => {
    if (!suppressClick) return;
    if (event.target.closest("a")) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  root.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { go(index - 1); restart(); }
    if (event.key === "ArrowRight") { go(index + 1); restart(); }
  });

  go(index); // восстановить слайд после перерисовки страницы
  start();
  heroController = { start, stop };
}

function rowHTML(title, list, opts = {}) {
  if (!list.length) return "";
  /* href — это ссылка «Все» у заголовка ряда. Раньше она попадала и в карточки,
     из-за чего клик по аниме открывал каталог. */
  const { href, layout, ...cardOpts } = opts;
  return `<section class="section">
    <div class="section-head">
      <h2>${esc(title)}</h2>
      ${href ? `<a class="link" href="${attr(href)}">Все ${ui.icon("chevron-right")}</a>` : ""}
    </div>
    ${layout === "grid"
      ? `<div class="grid-cards">${list.map((a) => ui.cardHTML(a, cardOpts)).join("")}</div>`
      : railHTML(list.map((a) => ui.cardHTML(a, cardOpts)).join(""))}
  </section>`;
}

/* Горизонтальная лента карточек: перетаскивание мышью + стрелки */
function railHTML(inner) {
  return `<div class="rail" data-rail>
    <button class="rail-arrow prev" type="button" data-rail-prev aria-label="Пролистать назад">${ui.icon("chevron-left")}</button>
    <div class="row-scroller">${inner}</div>
    <button class="rail-arrow next" type="button" data-rail-next aria-label="Пролистать вперёд">${ui.icon("chevron-right")}</button>
  </div>`;
}

function initRails() {
  $$("[data-rail]").forEach((rail) => {
    const scroller = rail.querySelector(".row-scroller");
    if (!scroller) return;
    const prev = rail.querySelector("[data-rail-prev]");
    const next = rail.querySelector("[data-rail-next]");

    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      rail.classList.toggle("has-overflow", max > 8);
      if (prev) prev.disabled = scroller.scrollLeft <= 4;
      if (next) next.disabled = scroller.scrollLeft >= max - 4;
    };

    /* Шаг всегда кратен карточке — после листания не остаётся обрезанных карточек */
    const cardStep = () => {
      const first = scroller.firstElementChild;
      const second = scroller.children[1];
      if (!first) return Math.round(scroller.clientWidth * 0.86);
      const gap = second ? second.offsetLeft - first.offsetLeft - first.offsetWidth : 0;
      return Math.max(1, Math.round(first.offsetWidth + Math.max(0, gap)));
    };
    const step = (direction) => {
      const perPage = Math.max(1, Math.floor((scroller.clientWidth + 1) / cardStep()));
      scroller.scrollBy({ left: direction * perPage * cardStep(), behavior: "smooth" });
    };
    prev?.addEventListener("click", () => step(-1));
    next?.addEventListener("click", () => step(1));

    let down = false;
    let startX = 0;
    let startLeft = 0;
    let moved = false;

    scroller.addEventListener("dragstart", (event) => event.preventDefault());

    /* Захват указателя берём только когда началось именно перетаскивание:
       иначе клик по карточке уходил в скроллер и ссылка не срабатывала. */
    scroller.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch" || (event.button !== undefined && event.button !== 0)) return;
      down = true;
      moved = false;
      startX = event.clientX;
      startLeft = scroller.scrollLeft;
    });

    scroller.addEventListener("pointermove", (event) => {
      if (!down) return;
      const delta = event.clientX - startX;
      if (!moved && Math.abs(delta) < 6) return;
      if (!moved) {
        moved = true;
        scroller.classList.add("is-dragging");
        try { scroller.setPointerCapture?.(event.pointerId); } catch { /* не критично */ }
      }
      scroller.scrollLeft = startLeft - delta;
      event.preventDefault();
    });

    const endDrag = (event) => {
      if (!down) return;
      down = false;
      scroller.classList.remove("is-dragging");
      try {
        if (event?.pointerId !== undefined && scroller.hasPointerCapture?.(event.pointerId)) {
          scroller.releasePointerCapture(event.pointerId);
        }
      } catch { /* не критично */ }
    };
    scroller.addEventListener("pointerup", endDrag);
    scroller.addEventListener("pointercancel", endDrag);
    scroller.addEventListener("pointerleave", endDrag);
    scroller.addEventListener("click", (event) => {
      if (!moved) return;
      event.preventDefault();
      event.stopPropagation();
      moved = false;
    }, true);

    scroller.addEventListener("scroll", update, { passive: true });
    scroller.querySelectorAll("img").forEach((img) => {
      if (img.complete) return;
      img.addEventListener("load", update, { once: true });
      img.addEventListener("error", update, { once: true });
    });
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(update).observe(scroller);
    }
    window.addEventListener("resize", debounce(update, 150));
    update();
  });
}

/* Шапка уезжает при прокрутке вниз и возвращается при прокрутке вверх:
   так блоки не «обрезаются» под липкой плашкой. */
function initHeaderScroll() {
  const header = document.getElementById("siteHeader");
  if (!header) return;
  let last = window.scrollY || 0;
  let ticking = false;

  const apply = () => {
    ticking = false;
    const y = window.scrollY || 0;
    header.classList.toggle("is-stuck", y > 6);
    const delta = y - last;
    if (Math.abs(delta) >= 8) {
      const navOpen = Boolean(document.querySelector(".header-inner.is-nav-open"));
      header.classList.toggle("is-hidden", delta > 0 && y > 180 && !navOpen);
      last = y;
    }
    /* Пока шапка уехала, липкие элементы прижимаются к верху страницы. */
    const offset = header.classList.contains("is-hidden")
      ? "0px"
      : `${Math.round(header.getBoundingClientRect().height)}px`;
    const root = document.documentElement;
    if (root.style.getPropertyValue("--header-offset") !== offset) {
      root.style.setProperty("--header-offset", offset);
    }
  };

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    (window.requestAnimationFrame || ((fn) => setTimeout(fn, 16)))(apply);
  }, { passive: true });
  apply();
}

function firstEpisodeForContinue(anime) {
  const history = store.getHistoryItem(anime.id);
  if (history) {
    const ep = store.findEpisode(anime, history.episodeId);
    if (ep) return ep;
  }
  return store.animeEpisodes(anime)[0] || null;
}

function homeView() {
  const published = store.publicAnime();
  setTitle("");

  if (!published.length) {
    const voice = esc(settings().kodikTranslation || "Рабочая партия");
    const states = {
      loading: {
        iconName: "download",
        title: "Собираю тайтлы озвучки",
        text: `Запрашиваю у Kodik всё, что залито в озвучку «${voice}». Это займёт пару секунд.`,
        action: "",
      },
      empty: {
        iconName: "info",
        title: "В озвучке пока нет тайтлов",
        text: autoError ? esc(autoError) : "Как только серии появятся в плеерах — они появятся и здесь.",
        action: `<button class="btn" type="button" data-auto-retry>${ui.icon("refresh")} Проверить снова</button>
          <a class="btn btn-ghost" href="#/admin/settings">${ui.icon("shield")} Настройки</a>`,
      },
      error: {
        iconName: "x",
        title: "Не удалось получить список озвучки",
        text: `${esc(autoError || "Kodik не ответил")}. Прямой запрос и прокси не сработали — включите VPN или укажите свой CORS-прокси: «Настройки сайта» → «Проверить ключи».`,
        action: `<button class="btn" type="button" data-auto-retry>${ui.icon("refresh")} Повторить</button>
          <a class="btn btn-ghost" href="#/admin/settings">${ui.icon("shield")} Настройки</a>`,
      },
      off: {
        iconName: "sparkles",
        title: "Каталог пуст",
        text: "Авто-каталог выключен: добавьте тайтлы через админ-панель или включите его в настройках.",
        action: `<a class="btn" href="#/admin">${ui.icon("shield")} Открыть админ-панель</a>`,
      },
      done: {
        iconName: "sparkles",
        title: "Здесь появится аниме",
        text: "Добавьте записи через админ-панель: название, постер, описание, эпизоды и код плеера.",
        action: `<a class="btn" href="#/admin">${ui.icon("shield")} Открыть админ-панель</a>`,
      },
    };
    const state = states[autoStatus] || states.done;
    view.innerHTML = `<div class="container">
      <div class="page-head">
        <span class="eyebrow">${esc(settings().siteName)}</span>
        <h1>${esc(settings().siteName)}</h1>
        <p>${autoStatus === "loading" ? "Первое включение занимает несколько секунд." : `Тайтлы озвучки «${voice}».`}</p>
      </div>
      ${ui.emptyHTML(state)}
    </div>`;
    return;
  }

  const releases = pickReleases(published);
  const history = store.getPrefs().history
    .map((item) => {
      const anime = published.find((a) => a.id === item.animeId);
      if (!anime) return null;
      const episode = store.findEpisode(anime, item.episodeId) || store.animeEpisodes(anime)[0];
      return { anime, episode, progress: item.progress || 0.02 };
    })
    .filter((item) => item && item.episode);

  const newest = sortFresh(published).slice(0, 14);
  const topRated = [...published].filter((a) => a.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, 14);
  const ongoing = sortFresh(published.filter(inProduction)).slice(0, 14);

  const genreSections = [...store.genreCounts().entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([genre]) => ({
      genre,
      list: sortFresh(published.filter((a) => a.genres.includes(genre))).slice(0, 14),
    }));

  view.innerHTML = `<div class="container">
    ${heroCarouselHTML(releases)}
    ${settings().continueWatching && history.length
      ? `<section class="section">
          <div class="section-head"><h2>Продолжить просмотр</h2></div>
          ${railHTML(history.map((h) => ui.cardHTML(h.anime, {
            progress: h.progress,
            href: `#/watch/${h.anime.id}/${h.episode.id}`,
          })).join(""))}
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

  initHeroCarousel();

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
    const q = state.q.trim();
    if (q) {
      list = list.filter((a) => matchesSearch(
        [a.title, a.originalTitle, a.studio, ...(a.aliases || []), ...a.genres, ...a.tags],
        q,
      ));
    }
    if (state.genre !== "all") list = list.filter((a) => a.genres.includes(state.genre));
    if (state.year !== "all") list = list.filter((a) => String(a.year) === state.year);
    if (state.status !== "all") list = list.filter((a) => a.status === state.status);

    switch (state.sort) {
      case "rating": list.sort((a, b) => b.rating - a.rating); break;
      case "title": list.sort((a, b) => a.title.localeCompare(b.title, "ru")); break;
      case "year": list.sort((a, b) => b.year - a.year); break;
      default: return sortFresh(list);
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
/* Описание и жанры: если карточка пришла из Kodik без них — добираем по Shikimori ID */
const detailsDone = new Set();

function ensureDetailsForAnime(anime) {
  if (!anime || detailsDone.has(anime.id)) return;
  if (anime.description && (anime.genres || []).length) return;
  if (!anime.shikimoriId) return;
  detailsDone.add(anime.id);
  getAnimeDetails(anime.shikimoriId).then((info) => {
    if (!info) return;
    anime.description = anime.description || info.description || "";
    anime.genres = (anime.genres && anime.genres.length) ? anime.genres : (info.genres || []);
    anime.rating = Number(anime.rating) || Number(info.rating) || 0;
    anime.malId = Number(anime.malId) || Number(info.malId) || 0;
    anime.status = STATUS_MAP[info.status] || anime.status;
    anime.episodesAired = Number(info.episodesAired) || anime.episodesAired || 0;
    anime.totalEpisodes = Number(info.episodes) || anime.totalEpisodes || 0;
    if (!anime.poster && info.poster) anime.poster = info.poster;
    render();
    if (!anime.totalEpisodes) {
      sources.resolveEpisodeTotal({ malId: anime.malId, title: anime.originalTitle || anime.title, year: anime.year })
        .then((total) => {
          if (!total.total) return;
          anime.totalEpisodes = total.total;
          if (!anime.malId && total.malId) anime.malId = total.malId;
          render();
        })
        .catch((error) => console.debug("Число серий:", error?.message));
    }
  }).catch((error) => {
    detailsDone.delete(anime.id);
    console.debug("Описание Shikimori:", error?.message);
  });
}

function animeView(id) {
  const anime = store.getAnime(id);
  if (!anime || (!anime.published && !store.isAdmin())) {
    notFoundView("Это аниме не найдено в каталоге.");
    return;
  }
  ensureDetailsForAnime(anime);
  setTitle(anime.title);

  const episodes = store.animeEpisodes(anime);
  const history = store.getHistoryItem(anime.id);
  const continueEp = history ? store.findEpisode(anime, history.episodeId) : null;
  const startEp = continueEp || episodes[0];
  const fav = store.isFavorite(anime.id);
  const related = store.publicAnime()
    .filter((a) => a.id !== anime.id && a.genres.some((g) => anime.genres.includes(g)))
    .slice(0, 8);

  const heroBanner = safeUrl(anime.banner) || safeUrl(anime.poster);
  view.innerHTML = `<div class="anime-hero" id="animeHero">
    <div class="anime-hero-bg">${heroBanner ? `<img src="${attr(heroBanner)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async" draggable="false" onerror="this.remove()" />` : ""}</div>
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
        ${railHTML(related.map((a) => ui.cardHTML(a)).join(""))}
      </section>` : ""}
    </div>
  </div>`;

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
/* Один запрос к CVH на тайтл: если в серии ещё нет плеера CVH — подтягиваем и перерисовываем */
const cvhDone = new Set();

function ensureCvhForAnime(anime) {
  if (!anime || cvhDone.has(anime.id)) return;
  const hasCvh = (anime.episodes || []).some((episode) => (episode.players || []).some((player) => player.type === "cvh"));
  if (hasCvh) return;
  const s = settings();
  if (!(anime.malId || anime.shikimoriId)) return;
  cvhDone.add(anime.id);
  const studio = String(s.cvhTranslation || "Рабочая партия").trim();
  sources.cvhPlaylist({
    id: anime.malId || anime.shikimoriId,
    pub: String(s.cvhPub || "747").trim(),
    aggr: String(s.cvhAggr || "mali").trim(),
    proxy: String(s.corsProxy || "").trim(),
  }).then((items) => {
    const found = sources.cvhEpisodes(items, { translation: studio });
    if (!found.length) return;
    const episodes = store.animeEpisodes(anime);
    found.forEach((episode) => {
      const url = sources.cvhPlayerUrl(episode.vkId);
      const target = episodes.find((item) => item.number === episode.number);
      if (!target) return;
      if ((target.players || []).some((player) => player.url === url)) return;
      target.players = [{ name: `CVH · ${episode.studio || studio}`, type: "cvh", url, code: "" }, ...(target.players || [])];
      if (!target.title && episode.title) target.title = episode.title;
    });
    render();
  }).catch((error) => {
    cvhDone.delete(anime.id);
    console.debug("CVH на странице серии:", error?.message);
  });
}

function watchView(id, episodeKey) {
  const anime = store.getAnime(id);
  if (!anime) {
    notFoundView("Аниме не найдено.");
    return;
  }
  ensureCvhForAnime(anime);
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
  /* CVH — основной плеер партии, поэтому он первый в списке и включён по умолчанию */
  const players = [...(episode.players || [])].sort((a, b) => (b.type === "cvh" ? 1 : 0) - (a.type === "cvh" ? 1 : 0));
  const requested = query.has("p") ? Number(query.get("p")) : 0;
  const playerIndex = Math.max(0, Math.min(players.length - 1, Number(requested) || 0));
  const player = players[playerIndex] || players[0];

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
          ${players.map((p, i) => `<option value="${i}"${i === playerIndex ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
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
    const chosen = players[i];
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
    const version = new URL(import.meta.url).search;
    const mod = await import(`./admin.js${version}`);
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
