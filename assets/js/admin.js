/* Админ-панель: контент, эпизоды, плееры, жанры, настройки сайта, публикация. */

import * as store from "./store.js";
import * as ui from "./ui.js";
import { fetchPosterSmart, posterCacheKey, posterUrlById, setCachedPoster } from "./shikimori.js";
import * as sources from "./sources.js";
import {
  $, $$, attr, clone, esc, formatDate, hueFrom, matchesSearch, safeUrl, searchForms, slugify,
  STATUS_LABELS, uid,
} from "./utils.js";

const PLAYER_TYPES = {
  iframe: "Iframe по ссылке",
  html: "Код вставки (embed)",
  video: "Видеофайл (.mp4 / .m3u8)",
  cvh: "CVH (CDNVideoHub)",
  demo: "Заглушка (без плеера)",
};

let ctx = null;     // { mount, catalog, refresh }
let draftCatalog = null;
let editorModel = null; // редактируемая копия аниме

/* ======================================================================
   Вход
   ====================================================================== */
function renderLogin() {
  ctx.mount.innerHTML = `<div class="container">
    <form class="login-card" id="loginForm" autocomplete="on">
      <a class="brand" href="#/" style="justify-content:center">
        <span class="brand-mark">★</span>
        <span class="brand-text"><strong>${esc(draftCatalog.settings.siteName)}</strong><small>админ-панель</small></span>
      </a>
      <h1>Вход в админ-панель</h1>
      <p>Управление каталогом, плеерами и оформлением сайта.</p>
      <div class="field">
        <label for="adminPassword">Пароль</label>
        <input id="adminPassword" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
      </div>
      <button class="btn btn-block" type="submit">${ui.icon("lock")} Войти</button>
      ${store.hasCustomPassword()
        ? `<p class="hint" style="text-align:center;color:var(--muted);font-size:.78rem">Пароль изменён администратором.</p>`
        : `<p class="hint" style="text-align:center;color:var(--muted);font-size:.78rem">Пароль по умолчанию: <code>${esc(store.DEFAULT_PASSWORD)}</code>. Смените его в разделе «Публикация».</p>`}
      <p class="hint" style="text-align:center;color:var(--muted);font-size:.74rem;line-height:1.5">Статический сайт: пароль защищает только интерфейс в этом браузере. Не используйте важные пароли.</p>
    </form>
  </div>`;

  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const password = $("#adminPassword").value;
    if (store.login(password)) {
      ui.toast("Добро пожаловать!", "ok");
      ctx.refresh();
    } else {
      ui.toast("Неверный пароль", "err");
      $("#adminPassword").select();
    }
  });
  setTimeout(() => $("#adminPassword")?.focus(), 60);
}

/* ======================================================================
   Оболочка
   ====================================================================== */
const TABS = [
  { key: "content", label: "Контент", icon: "grid" },
  { key: "import", label: "Импорт", icon: "download" },
  { key: "genres", label: "Жанры", icon: "sparkles" },
  { key: "settings", label: "Настройки сайта", icon: "edit" },
  { key: "publish", label: "Публикация и доступ", icon: "upload" },
];

function shell(active, body) {
  const state = store.getState();
  const draftBadge = state.source === "draft"
    ? `<span class="chip chip-accent" title="Правки сохранены в этом браузере">${ui.icon("save")} Черновик${state.draftSavedAt ? ` · ${esc(formatDate(state.draftSavedAt))}` : ""}</span>`
    : `<span class="chip">${ui.icon("info")} data/catalog.json</span>`;

  return `<div class="container admin-shell">
    <div class="admin-top">
      <div>
        <span class="eyebrow">Управление</span>
        <h1>Админ-панель</h1>
        <p>Добавляйте аниме, подключайте плееры кодом и меняйте весь сайт без пересборки.</p>
      </div>
      <div class="admin-top-actions">
        ${draftBadge}
        <a class="btn btn-ghost btn-sm" href="#/">${ui.icon("external")} На сайт</a>
        <button class="btn btn-ghost btn-sm" type="button" id="adminLogout">${ui.icon("logout")} Выйти</button>
      </div>
    </div>

    <div class="admin-tabs" role="tablist">
      ${TABS.map((tab) => `<button type="button" role="tab" aria-selected="${tab.key === active}"
        data-tab="${tab.key}">${esc(tab.label)}</button>`).join("")}
    </div>

    <div id="adminBody">${body}</div>
  </div>`;
}

function bindShell() {
  $$("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = `#/admin/${btn.dataset.tab}`; });
  });
  $("#adminLogout")?.addEventListener("click", () => {
    store.logout();
    ui.toast("Вы вышли из админки", "info");
    ctx.refresh();
  });
}

/* ======================================================================
   Контент
   ====================================================================== */
function contentTab() {
  const list = [...draftCatalog.anime].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const rowsHTML = list.length
    ? list.map((anime) => `<tr data-row="${attr(anime.id)}">
        <td>
          <div class="cell-title">
            <div class="mini-poster" style="--h:${hueFrom(anime.title)}">${ui.posterInner(anime)}</div>
            <div style="min-width:0">
              <b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:34ch">${esc(anime.title)}</b>
              <small class="muted">${esc(anime.id)} · ${esc(String(anime.year))}</small>
            </div>
          </div>
        </td>
        <td>${esc(anime.genres.join(", ") || "—")}</td>
        <td class="nowrap">${anime.episodes.length}</td>
        <td class="nowrap">${anime.rating ? `★ ${anime.rating.toFixed(1)}` : "—"}</td>
        <td>
          <label class="switch" title="Опубликовано">
            <input type="checkbox" data-toggle-published="${attr(anime.id)}" ${anime.published ? "checked" : ""} />
            <span class="track"></span>
          </label>
        </td>
        <td>
          <label class="switch" title="В подборку на главной">
            <input type="checkbox" data-toggle-featured="${attr(anime.id)}" ${anime.featured ? "checked" : ""} />
            <span class="track"></span>
          </label>
        </td>
        <td>
          <div class="row-actions">
            <a class="btn btn-soft btn-sm" href="#/admin/edit/${attr(anime.id)}">${ui.icon("edit")} Изменить</a>
            <a class="btn btn-ghost btn-sm" href="#/anime/${attr(anime.id)}" title="Открыть на сайте">${ui.icon("external")}</a>
            <button class="btn btn-ghost btn-sm" type="button" data-fetch-poster="${attr(anime.id)}" title="Обновить постер с Shikimori">${ui.icon("download")}</button>
            <button class="btn btn-ghost btn-sm" type="button" data-duplicate="${attr(anime.id)}" title="Дублировать">${ui.icon("copy")}</button>
            <button class="btn btn-ghost btn-sm" type="button" data-delete="${attr(anime.id)}" title="Удалить">${ui.icon("trash")}</button>
          </div>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="7"><div class="empty" style="border:0;background:none">Пока нет ни одного аниме. Нажмите «Добавить аниме».</div></td></tr>`;

  const publishedAnime = store.getPublishedCatalog?.()?.anime || [];
  const draftOnly = store.hasDraft() && publishedAnime.length === 0 && draftCatalog.anime.length > 0;

  return `<div class="stack" style="--gap:14px">
    <div class="notice">
      ${ui.icon("info")}
      <div><strong>Правки сохраняются локально в этом браузере.</strong> Чтобы их увидели посетители, выгрузите
      <code>catalog.json</code> в разделе «Публикация и доступ» и замените файл <code>data/catalog.json</code> в репозитории.</div>
    </div>
    ${store.hasDraft() ? `<div class="notice">
      ${ui.icon("info")}
      <div><strong>${draftOnly
        ? "Сайт показывает этот черновик, а не авто-каталог озвучки."
        : "Есть локальный черновик — сайт показывает его, а не data/catalog.json."}</strong>
      Тайтлов в черновике: ${draftCatalog.anime.length}.
      <button class="btn btn-soft btn-sm" type="button" id="dropDraft">${ui.icon("trash")} Убрать черновик</button>
      </div>
    </div>` : ""}
    <div class="panel">
    <div class="panel-head">
      <div>
        <h2>Каталог · ${draftCatalog.anime.length}</h2>
        <p>Переключатели: публикация на сайте и участие в подборке на главной.</p>
      </div>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" id="bulkPosters" title="Подтянуть постеры для всех аниме без картинки">
          ${ui.icon("download")} Постеры
        </button>
        <a class="btn" href="#/admin/new">${ui.icon("plus")} Добавить аниме</a>
      </div>
    </div>
    <div class="field" style="margin-bottom:14px;max-width:360px">
      <input type="search" id="adminSearch" placeholder="Поиск по названию или id…" />
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th>Аниме</th><th>Жанры</th><th>Эп.</th><th>Рейтинг</th><th>Опубл.</th><th>Главная</th><th>Действия</th>
        </tr></thead>
        <tbody id="adminRows">${rowsHTML}</tbody>
      </table>
    </div>
  </div>
  </div>`;
}

function bindContentTab() {
  $("#dropDraft")?.addEventListener("click", async () => {
    if (!window.confirm("Убрать локальный черновик? Сайт вернётся к опубликованному каталогу и авто-каталогу озвучки.")) return;
    store.discardDraft();
    await store.loadCatalog();
    draftCatalog = clone(store.getCatalog());
    ui.toast("Черновик убран — сайт собирается из озвучки", "ok");
    ctx.refresh();
  });

  $("#adminSearch")?.addEventListener("input", (event) => {
    const query = event.target.value.trim();
    $$("#adminRows tr[data-row]").forEach((row) => {
      const anime = draftCatalog.anime.find((a) => a.id === row.dataset.row);
      const hit = !query || matchesSearch(
        [anime?.title, anime?.id, anime?.originalTitle, ...(anime?.aliases || []), ...(anime?.genres || [])],
        query,
      );
      row.classList.toggle("hide", !hit);
    });
  });

  const persist = () => {
    try {
      store.saveDraft(draftCatalog);
      ui.toast("Сохранено локально", "ok");
    } catch (error) {
      ui.toast(error.message, "err");
    }
  };

  $$("[data-toggle-published]").forEach((input) => {
    input.addEventListener("change", () => {
      const anime = draftCatalog.anime.find((a) => a.id === input.dataset.togglePublished);
      if (anime) anime.published = input.checked;
      persist();
    });
  });

  $$("[data-toggle-featured]").forEach((input) => {
    input.addEventListener("change", () => {
      const anime = draftCatalog.anime.find((a) => a.id === input.dataset.toggleFeatured);
      if (anime) anime.featured = input.checked;
      persist();
    });
  });

  $$("[data-duplicate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const anime = draftCatalog.anime.find((a) => a.id === btn.dataset.duplicate);
      if (!anime) return;
      const copy = clone(anime);
      copy.id = uniqueId(`${anime.id}-copy`);
      copy.title = `${anime.title} (копия)`;
      copy.createdAt = new Date().toISOString();
      copy.published = false;
      copy.featured = false;
      draftCatalog.anime.unshift(copy);
      persist();
      ctx.refresh();
    });
  });

  $("#bulkPosters")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    const targets = draftCatalog.anime.filter((anime) => !anime.poster);
    if (!targets.length) { ui.toast("У всех аниме уже есть постеры", "info"); return; }
    const original = btn.innerHTML;
    btn.disabled = true;
    let ok = 0;
    for (let i = 0; i < targets.length; i += 1) {
      btn.textContent = `Постеры ${i + 1}/${targets.length}…`;
      try {
        const data = await resolvePoster(targets[i]);
        if (data.poster) {
          targets[i].poster = data.poster;
          if (!targets[i].shikimoriId && data.shikimoriId) targets[i].shikimoriId = data.shikimoriId;
          setCachedPoster(posterCacheKey(targets[i]), data.poster);
          ok += 1;
        }
      } catch (error) {
        console.debug("poster:", error?.message);
      }
    }
    btn.disabled = false;
    btn.innerHTML = original;
    try {
      store.saveDraft(draftCatalog);
      ui.toast(ok ? `Постеры обновлены: ${ok} из ${targets.length}` : "Не удалось получить постеры", ok ? "ok" : "err");
    } catch (error) {
      ui.toast(error.message, "err");
    }
    ctx.refresh();
  });

  $$("[data-fetch-poster]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const anime = draftCatalog.anime.find((item) => item.id === btn.dataset.fetchPoster);
      if (!anime) return;
      btn.disabled = true;
      try {
        const data = await resolvePoster(anime);
        if (!data.poster) throw new Error("Постер не найден ни на Shikimori, ни на AniList, ни на MyAnimeList");
        anime.poster = data.poster;
        if (!anime.shikimoriId && data.shikimoriId) anime.shikimoriId = data.shikimoriId;
        setCachedPoster(posterCacheKey(anime), data.poster);
        store.saveDraft(draftCatalog);
        ui.toast("Постер обновлён", "ok");
        ctx.refresh();
      } catch (error) {
        ui.toast(error?.message || "Не удалось получить постер", "err");
        btn.disabled = false;
      }
    });
  });

  $$("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.delete;
      const anime = draftCatalog.anime.find((a) => a.id === id);
      if (!anime) return;
      if (!window.confirm(`Удалить «${anime.title}»? Действие нельзя отменить (кроме отмены черновика в разделе «Публикация»).`)) return;
      draftCatalog.anime = draftCatalog.anime.filter((a) => a.id !== id);
      persist();
      ctx.refresh();
    });
  });
}

function uniqueId(base) {
  let id = slugify(base);
  let n = 2;
  while (draftCatalog.anime.some((a) => a.id === id)) { id = `${slugify(base)}-${n}`; n += 1; }
  return id;
}

/* ======================================================================
   Редактор аниме
   ====================================================================== */
function blankAnime() {
  return {
    id: "",
    title: "",
    originalTitle: "",
    year: new Date().getFullYear(),
    status: "ongoing",
    genres: [],
    rating: 0,
    ageRating: "16+",
    description: "",
    poster: "",
    banner: "",
    shikimoriId: "",
    malId: 0,
    cvhId: "",
    studio: "",
    director: "",
    country: "Япония",
    tags: [],
    aliases: [],
    published: true,
    featured: false,
    createdAt: new Date().toISOString(),
    episodes: [{
      id: uid("ep"),
      number: 1,
      title: "",
      date: "",
      duration: "24 мин",
      players: [{ id: uid("pl"), name: "Основной", type: "demo", url: "", code: "" }],
    }],
  };
}

function fieldHTML({ label, name, value = "", type = "text", span = false, hint = "", placeholder = "", min, max, step }) {
  return `<div class="field${span ? " span-2" : ""}">
    <label for="f-${name}">${label}${hint ? ` <small>${hint}</small>` : ""}</label>
    <input id="f-${name}" name="${name}" type="${type}" value="${attr(value)}"
      ${placeholder ? `placeholder="${attr(placeholder)}"` : ""}
      ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""}
      ${step !== undefined ? `step="${step}"` : ""} />
  </div>`;
}

function selectHTML({ label, name, value, options, span = false, hint = "" }) {
  return `<div class="field${span ? " span-2" : ""}">
    <label for="f-${name}">${label}${hint ? ` <small>${hint}</small>` : ""}</label>
    <select id="f-${name}" name="${name}">
      ${options.map(([val, text]) => `<option value="${attr(val)}"${String(val) === String(value) ? " selected" : ""}>${esc(text)}</option>`).join("")}
    </select>
  </div>`;
}

function playerEditorHTML(player, epIndex, plIndex) {
  return `<div class="player-card" data-player-index="${plIndex}" data-pl-type="${attr(player.type)}">
    <div class="player-card-head">
      <b>Плеер ${plIndex + 1}</b>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-player-up="${epIndex}:${plIndex}" title="Выше" ${plIndex === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost btn-sm" type="button" data-player-down="${epIndex}:${plIndex}" title="Ниже">↓</button>
        <button class="btn btn-ghost btn-sm" type="button" data-player-remove="${epIndex}:${plIndex}" title="Удалить плеер">${ui.icon("trash")}</button>
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label>Название плеера / озвучка</label>
        <input data-pl-field="name" value="${attr(player.name)}" placeholder="Например: AniLibria" />
      </div>
      <div class="field">
        <label>Тип</label>
        <select data-pl-field="type">
          ${Object.entries(PLAYER_TYPES).map(([val, text]) => `<option value="${val}"${val === player.type ? " selected" : ""}>${esc(text)}</option>`).join("")}
        </select>
      </div>
      <div class="field span-2${player.type === "video" || player.type === "iframe" ? "" : " hide"}" data-pl-url>
        <label>Ссылка на видео или iframe <small>https://…</small></label>
        <input data-pl-field="url" value="${attr(player.url)}" placeholder="https://example.com/embed/123 или https://cdn.example.com/ep1.mp4" />
      </div>
      <div class="field span-2${player.type === "html" ? "" : " hide"}" data-pl-code>
        <label>Код вставки <small>HTML/iframe от плеера</small></label>
        <textarea data-pl-field="code" rows="4" placeholder='&lt;iframe src="https://kodikplayer.com/…" allowfullscreen&gt;&lt;/iframe&gt;'>${esc(player.code)}</textarea>
      </div>
    </div>
    ${player.type === "demo" ? `<p class="hint">Заглушка: на сайте покажется «Плеер ещё не подключён». Выберите тип и добавьте ссылку или код.</p>` : ""}
  </div>`;
}

function episodeEditorHTML(episode, epIndex) {
  const dateValue = episode.date ? String(episode.date).slice(0, 10) : "";
  return `<div class="ep-card" data-ep-index="${epIndex}">
    <div class="ep-card-head">
      <strong>Серия ${esc(String(episode.number))}</strong>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-ep-up="${epIndex}" title="Выше" ${epIndex === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost btn-sm" type="button" data-ep-down="${epIndex}" title="Ниже">↓</button>
        <button class="btn btn-ghost btn-sm" type="button" data-ep-remove="${epIndex}">${ui.icon("trash")} Удалить</button>
      </div>
    </div>

    <div class="form-grid">
      <div class="field" style="max-width:120px">
        <label>Номер</label>
        <input data-ep-field="number" type="number" min="1" step="1" value="${attr(episode.number)}" />
      </div>
      <div class="field">
        <label>Название серии</label>
        <input data-ep-field="title" value="${attr(episode.title)}" placeholder="Необязательно" />
      </div>
      <div class="field">
        <label>Дата выхода</label>
        <input data-ep-field="date" type="date" value="${attr(dateValue)}" />
      </div>
      <div class="field">
        <label>Длительность</label>
        <input data-ep-field="duration" value="${attr(episode.duration)}" placeholder="24 мин" />
      </div>
    </div>

    <div class="stack" style="--gap:10px">
      ${episode.players.map((pl, plIndex) => playerEditorHTML(pl, epIndex, plIndex)).join("")}
    </div>
    <div>
      <button class="btn btn-soft btn-sm" type="button" data-player-add="${epIndex}">${ui.icon("plus")} Добавить плеер</button>
    </div>
  </div>`;
}

function editorHTML(anime, isNew) {
  const genreChecks = draftCatalog.genres.map((genre) => `<label class="chip" style="cursor:pointer">
      <input type="checkbox" data-genre-check value="${attr(genre)}" ${anime.genres.includes(genre) ? "checked" : ""} style="accent-color:var(--accent)" />
      ${esc(genre)}
    </label>`).join("");

  return `<div class="panel">
    <div class="panel-head">
      <div>
        <h2>${isNew ? "Новое аниме" : `Редактирование: ${esc(anime.title || "без названия")}`}</h2>
        <p>Заполните карточку, добавьте эпизоды и плееры. Плеер можно подключить ссылкой или готовым кодом вставки.</p>
      </div>
      <div class="row-actions">
        <a class="btn btn-ghost btn-sm" href="#/admin/content">${ui.icon("chevron-left")} К списку</a>
        <button class="btn btn-sm" type="submit" form="animeForm">${ui.icon("save")} Сохранить</button>
      </div>
    </div>

    <form id="animeForm" class="stack" style="--gap:20px" novalidate>
      <div class="panel" style="background:var(--surface-2);padding:14px 16px">
        <div class="field-row" style="align-items:center;gap:10px;flex-wrap:wrap">
          <strong style="font-size:.86rem">Быстрый импорт</strong>
          <div class="suggest-wrap" style="flex:1 1 220px">
            <input id="quickImport" type="text" autocomplete="off" placeholder="ID Shikimori, ссылка или название тайтла" style="width:100%;min-height:38px;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface)" />
            <div class="suggest" id="quickSuggest" hidden></div>
          </div>
          <button class="btn btn-sm" type="button" id="quickImportBtn">${ui.icon("download")} Заполнить всё</button>
        </div>
        <p class="hint">Подтянет название, оригинальное название, описание, жанры, рейтинг, возраст, студию, постер и широкий баннер. Плееры и озвучки добавляете сами.</p>
      </div>

      <div class="form-grid">
        ${fieldHTML({ label: "Название *", name: "title", value: anime.title, span: true, placeholder: "Например: Атака титанов" })}
        ${fieldHTML({ label: "Оригинальное название", name: "originalTitle", value: anime.originalTitle, span: true, placeholder: "Shingeki no Kyojin" })}
        ${fieldHTML({ label: "Год", name: "year", value: anime.year, type: "number", min: 1950, max: 2100 })}
        ${selectHTML({ label: "Статус", name: "status", value: anime.status, options: Object.entries(STATUS_LABELS) })}
        ${fieldHTML({ label: "Рейтинг", name: "rating", value: anime.rating, type: "number", min: 0, max: 10, step: "0.1" })}
        ${fieldHTML({ label: "Возраст", name: "ageRating", value: anime.ageRating, placeholder: "16+" })}
        ${fieldHTML({ label: "Студия", name: "studio", value: anime.studio, placeholder: "MAPPA" })}
        ${fieldHTML({ label: "Режиссёр", name: "director", value: anime.director })}
        ${fieldHTML({ label: "Страна", name: "country", value: anime.country })}
        ${fieldHTML({ label: "Теги", name: "tags", value: anime.tags.join(", "), hint: "через запятую" })}
        ${fieldHTML({ label: "Shikimori ID", name: "shikimoriId", value: anime.shikimoriId, placeholder: "16498", hint: "для автопостера" })}
        ${fieldHTML({ label: "ID в CVH", name: "cvhId", value: anime.cvhId, placeholder: "51019", hint: "для плееров CVH (Shikimori)" })}

        <div class="field span-2">
          <label>Описание</label>
          <textarea name="description" rows="6" placeholder="О чём аниме…">${esc(anime.description)}</textarea>
        </div>

        <div class="field span-2">
          <label>Жанры</label>
          <div class="tag-list">${genreChecks || '<span class="muted small">Сначала добавьте жанры в разделе «Жанры»</span>'}</div>
        </div>

        <div class="field span-2">
          <label for="f-poster">Постер <small>ссылка, файл или Shikimori</small></label>
          <div class="field-row">
            <input id="f-poster" name="poster" type="text" value="${attr(anime.poster)}" placeholder="https://…/poster.jpg" style="flex:1 1 220px" />
            <button class="btn btn-soft btn-sm" type="button" id="fetchPoster" title="Заполнить карточку по Shikimori ID или названию">
              ${ui.icon("download")} Заполнить с Shikimori
            </button>
            <label class="btn btn-ghost btn-sm" style="margin:0">
              ${ui.icon("upload")} Файл
              <input type="file" accept="image/*" data-upload="poster" class="visually-hidden" />
            </label>
            <span class="poster-preview${anime.poster ? "" : " hide"}" id="posterPreview">
              ${anime.poster ? `<img src="${attr(safeUrl(anime.poster))}" alt="" onerror="this.remove()" />` : ""}
            </span>
          </div>
          <p class="hint">Укажите Shikimori ID — постер, название, описание, жанры, рейтинг и баннер подтянутся автоматически. Загруженные файлы хранятся в localStorage (лимит ~5 МБ).</p>
        </div>

        <div class="field span-2">
          <label for="f-banner">Баннер <small>широкое изображение для шапки, необязательно</small></label>
          <div class="field-row">
            <input id="f-banner" name="banner" type="text" value="${attr(anime.banner)}" placeholder="https://…/banner.jpg" style="flex:1 1 240px" />
            <label class="btn btn-ghost btn-sm" style="margin:0">
              ${ui.icon("upload")} Файл
              <input type="file" accept="image/*" data-upload="banner" class="visually-hidden" />
            </label>
          </div>
        </div>

        <div class="field span-2">
          <div class="field-row" style="gap:22px">
            <label class="switch"><input type="checkbox" name="published" ${anime.published ? "checked" : ""} /><span class="track"></span> Опубликовано</label>
            <label class="switch"><input type="checkbox" name="featured" ${anime.featured ? "checked" : ""} /><span class="track"></span> Показывать на главной</label>
          </div>
        </div>
      </div>

      <div class="panel" style="background:var(--surface-2)">
        <div class="panel-head">
          <div>
            <h2>Эпизоды и плееры</h2>
            <p>Каждый эпизод может иметь несколько плееров (озвучек) — зритель выберет нужный.</p>
          </div>
          <div class="field-row" style="gap:8px">
            <button class="btn btn-ghost btn-sm" type="button" id="kodikPlayers">${ui.icon("play")} Плееры из Kodik</button>
            <button class="btn btn-ghost btn-sm" type="button" id="cvhPlayers">${ui.icon("play")} Плееры из CVH</button>
            <button class="btn btn-ghost btn-sm" type="button" id="translateTitles">${ui.icon("sparkles")} Названия по-русски</button>
            <button class="btn btn-ghost btn-sm" type="button" id="bulkEpisodeTitles">${ui.icon("edit")} Названия списком</button>
            <button class="btn btn-soft btn-sm" type="button" id="addEpisode">${ui.icon("plus")} Эпизод</button>
          </div>
        </div>
        <div class="panel" id="bulkTitles" hidden style="margin-bottom:14px;background:var(--surface-3)">
          <label for="bulkTitlesInput" class="hint">Вставьте названия серий — по одному в строке, по порядку. Пустые строки пропускаются.</label>
          <textarea id="bulkTitlesInput" rows="6" placeholder="Маска бога войны&#10;Маска дыма&#10;…" style="margin-top:8px"></textarea>
          <div class="field-row" style="margin-top:10px">
            <button class="btn btn-sm" type="button" id="bulkTitlesApply">${ui.icon("check")} Применить</button>
            <button class="btn btn-ghost btn-sm" type="button" id="bulkTitlesCancel">Отмена</button>
          </div>
        </div>
        <div class="ep-editor" id="episodeEditor">
          ${anime.episodes.map((ep, i) => episodeEditorHTML(ep, i)).join("") ||
            '<p class="muted small">Эпизодов нет. Нажмите «Эпизод».</p>'}
        </div>
      </div>

      <div class="sticky-actions">
        <span class="status" id="editorStatus">${isNew ? "Новая запись" : "Изменения сохраняются в черновик"}</span>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="#/admin/content">Отмена</a>
        <button class="btn btn-sm" type="submit">${ui.icon("save")} Сохранить</button>
      </div>
    </form>
  </div>`;
}

function collectPlayers(card) {
  const value = (name) => card.querySelector(`[data-pl-field="${name}"]`)?.value ?? "";
  return {
    id: card.dataset.playerId || uid("pl"),
    name: value("name").trim() || "Плеер",
    type: value("type"),
    url: value("url").trim(),
    code: value("code"),
  };
}

function collectEpisodes() {
  return $$("#episodeEditor [data-ep-index]").map((card, index) => {
    const value = (name) => card.querySelector(`[data-ep-field="${name}"]`)?.value ?? "";
    return {
      id: card.dataset.epId || uid("ep"),
      number: Number(value("number")) || index + 1,
      title: value("title").trim(),
      date: value("date"),
      duration: value("duration").trim(),
      players: $$("[data-player-index]", card).map((playerCard) => {
        const player = collectPlayers(playerCard);
        return player;
      }),
    };
  });
}

function captureEditorValues() {
  if (!editorModel) return;
  const form = $("#animeForm");
  if (!form) return;
  const get = (name) => form.elements[name]?.value ?? "";
  editorModel.title = get("title").trim();
  editorModel.originalTitle = get("originalTitle").trim();
  editorModel.year = Number(get("year")) || new Date().getFullYear();
  editorModel.status = get("status");
  editorModel.rating = Math.max(0, Math.min(10, Number(get("rating")) || 0));
  editorModel.ageRating = get("ageRating").trim();
  editorModel.studio = get("studio").trim();
  editorModel.director = get("director").trim();
  editorModel.country = get("country").trim();
  editorModel.tags = get("tags").split(",").map((t) => t.trim()).filter(Boolean);
  editorModel.description = get("description").trim();
  editorModel.poster = get("poster").trim();
  editorModel.banner = get("banner").trim();
  editorModel.shikimoriId = get("shikimoriId").trim();
  editorModel.cvhId = get("cvhId").trim();
  editorModel.published = form.elements.published.checked;
  editorModel.featured = form.elements.featured.checked;
  editorModel.genres = $$("[data-genre-check]:checked").map((input) => input.value);
  editorModel.episodes = collectEpisodes().map((ep, i) => ({ ...ep, number: ep.number || i + 1 }));
}

function bindEpisodeControls() {
  const wrap = $("#episodeEditor");
  if (!wrap) return;

  /* Значения уже собраны обработчиком до изменения модели —
     здесь только перерисовка, иначе правка затирается. */
  const refresh = () => {
    const episodesWrap = $("#episodeEditor");
    if (!episodesWrap) return;
    episodesWrap.innerHTML = editorModel.episodes.map((ep, i) => episodeEditorHTML(ep, i)).join("")
      || '<p class="muted small">Эпизодов нет. Нажмите «Эпизод».</p>';
    bindEpisodeControls();
  };

  $$("[data-ep-up]", wrap).forEach((btn) => {
    btn.addEventListener("click", () => {
      captureEditorValues();
      const i = Number(btn.dataset.epUp);
      if (i > 0) {
        const arr = editorModel.episodes;
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        arr.forEach((ep, idx) => { ep.number = idx + 1; });
      }
      refresh();
    });
  });
  $$("[data-ep-down]", wrap).forEach((btn) => {
    btn.addEventListener("click", () => {
      captureEditorValues();
      const i = Number(btn.dataset.epDown);
      const arr = editorModel.episodes;
      if (i < arr.length - 1) {
        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        arr.forEach((ep, idx) => { ep.number = idx + 1; });
      }
      refresh();
    });
  });
  $$("[data-ep-remove]", wrap).forEach((btn) => {
    btn.addEventListener("click", () => {
      captureEditorValues();
      if (editorModel.episodes.length <= 1) {
        ui.toast("Должен остаться хотя бы один эпизод", "err");
        return;
      }
      editorModel.episodes.splice(Number(btn.dataset.epRemove), 1);
      refresh();
    });
  });
  $$("[data-player-add]", wrap).forEach((btn) => {
    btn.addEventListener("click", () => {
      captureEditorValues();
      const ep = editorModel.episodes[Number(btn.dataset.playerAdd)];
      if (!ep) return;
      ep.players.push({ id: uid("pl"), name: `Плеер ${ep.players.length + 1}`, type: "demo", url: "", code: "" });
      refresh();
    });
  });
  $$("[data-player-remove]", wrap).forEach((btn) => {
    btn.addEventListener("click", () => {
      captureEditorValues();
      const [epIndex, plIndex] = btn.dataset.playerRemove.split(":").map(Number);
      const ep = editorModel.episodes[epIndex];
      if (!ep || ep.players.length <= 1) {
        ui.toast("У эпизода должен остаться хотя бы один плеер", "err");
        return;
      }
      ep.players.splice(plIndex, 1);
      refresh();
    });
  });
  $$("[data-player-up]", wrap).forEach((btn) => {
    btn.addEventListener("click", () => {
      captureEditorValues();
      const [epIndex, plIndex] = btn.dataset.playerUp.split(":").map(Number);
      const players = editorModel.episodes[epIndex]?.players;
      if (players && plIndex > 0) [players[plIndex - 1], players[plIndex]] = [players[plIndex], players[plIndex - 1]];
      refresh();
    });
  });
  $$("[data-player-down]", wrap).forEach((btn) => {
    btn.addEventListener("click", () => {
      captureEditorValues();
      const [epIndex, plIndex] = btn.dataset.playerDown.split(":").map(Number);
      const players = editorModel.episodes[epIndex]?.players;
      if (players && plIndex < players.length - 1) [players[plIndex + 1], players[plIndex]] = [players[plIndex], players[plIndex + 1]];
      refresh();
    });
  });

  // Переключение полей в зависимости от типа плеера
  $$("[data-pl-field='type']", wrap).forEach((select) => {
    select.addEventListener("change", () => {
      const card = select.closest("[data-player-index]");
      const urlField = card.querySelector("[data-pl-url]");
      const codeField = card.querySelector("[data-pl-code]");
      urlField.classList.toggle("hide", !["video", "iframe"].includes(select.value));
      codeField.classList.toggle("hide", select.value !== "html");
      card.dataset.plType = select.value;
    });
  });
}

function addEpisode() {
  captureEditorValues();
  const last = editorModel.episodes[editorModel.episodes.length - 1];
  editorModel.episodes.push({
    id: uid("ep"),
    number: (last?.number || editorModel.episodes.length) + 1,
    title: "",
    date: "",
    duration: last?.duration || "24 мин",
    players: [{ id: uid("pl"), name: last?.players?.[0]?.name || "Основной", type: "demo", url: "", code: "" }],
  });
  const wrap = $("#episodeEditor");
  wrap.innerHTML = editorModel.episodes.map((ep, i) => episodeEditorHTML(ep, i)).join("");
  bindEpisodeControls();
  wrap.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function goAdmin(hash) {
  if (location.hash === hash) ctx.refresh();
  else location.hash = hash;
}

let savingEditor = false;

async function saveEditor() {
  if (savingEditor) return;
  savingEditor = true;
  try {
    await saveEditorInner();
  } finally {
    savingEditor = false;
  }
}

async function saveEditorInner() {
  captureEditorValues();
  if (!editorModel.title) {
    ui.toast("Укажите название аниме", "err");
    $("#f-title")?.focus();
    return;
  }
  if (!editorModel.poster) {
    const statusEl = document.getElementById("editorStatus");
    if (statusEl) statusEl.textContent = "Ищу постер на Shikimori…";
    try {
      const data = await fetchPosterSmart(editorModel);
      if (data?.poster) {
        editorModel.poster = data.poster;
        if (!editorModel.shikimoriId && data.shikimoriId) editorModel.shikimoriId = data.shikimoriId;
      }
    } catch (error) {
      console.debug("poster:", error?.message);
    }
  }
  if (!editorModel.episodes.length) {
    editorModel.episodes.push({
      id: uid("ep"), number: 1, title: "", date: "", duration: "", players: [{ id: uid("pl"), name: "Основной", type: "demo", url: "", code: "" }],
    });
  }
  if (!editorModel.id) {
    editorModel.id = uniqueId(editorModel.title);
    editorModel.createdAt = new Date().toISOString();
    draftCatalog.anime.unshift(editorModel);
  } else {
    const index = draftCatalog.anime.findIndex((a) => a.id === editorModel.id);
    if (index >= 0) draftCatalog.anime[index] = editorModel;
    else draftCatalog.anime.unshift(editorModel);
  }

  // Новые жанры из карточки попадают в общий список
  editorModel.genres.forEach((genre) => {
    if (!draftCatalog.genres.includes(genre)) draftCatalog.genres.push(genre);
  });

  try {
    store.saveDraft(draftCatalog);
    ui.toast("Аниме сохранено в черновик", "ok");
    editorModel = null;
    goAdmin("#/admin/content");
  } catch (error) {
    ui.toast(error.message, "err");
  }
}

function updatePosterPreview(url) {
  const box = document.getElementById("posterPreview");
  if (!box) return;
  const src = safeUrl(url);
  box.classList.toggle("hide", !src);
  box.innerHTML = src
    ? `<img src="${attr(src)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.closest('#posterPreview')?.classList.add('is-broken');this.remove()" />`
    : "";
  box.classList.toggle("is-broken", false);
}

function setField(name, value) {
  if (value === undefined || value === null || value === "") return;
  const input = $(`#animeForm [name="${name}"]`) || $(`[name="${name}"]`);
  if (input && "value" in input) input.value = String(value);
}

function applyImportedFields(data, { episodes = true } = {}) {
  if (!data) return;
  if (data.shikimoriId) setField("shikimoriId", data.shikimoriId);
  if (data.malId && editorModel) {
    editorModel.malId = Number(data.malId) || 0;
    editorModel.cvhId = editorModel.cvhId || String(data.malId);
  }
  setField("poster", data.poster);
  setField("banner", data.banner);
  setField("title", data.title);
  setField("originalTitle", data.originalTitle);
  setField("year", data.year);
  setField("rating", data.rating ? Number(data.rating).toFixed(1) : "");
  setField("ageRating", data.ageRating);
  setField("studio", data.studio);
  const statusInput = $("#animeForm [name='status']");
  if (statusInput && data.status && STATUS_LABELS[data.status]) statusInput.value = data.status;
  // Внимание: в документе есть <meta name="description">, поэтому ищем строго внутри формы.
  const descInput = $("#animeForm [name='description']");
  if (descInput && data.description) descInput.value = data.description;

  (data.genres || []).filter(Boolean).forEach((genre) => {
    if (!draftCatalog.genres.includes(genre)) draftCatalog.genres.push(genre);
    const existing = Array.from(document.querySelectorAll("[data-genre-check]"))
      .find((input) => input.value === genre);
    if (existing) {
      existing.checked = true;
      return;
    }
    const wrap = document.querySelector(".tag-list");
    if (!wrap) return;
    const label = document.createElement("label");
    label.className = "chip";
    label.style.cursor = "pointer";
    label.innerHTML = `<input type="checkbox" data-genre-check value="${attr(genre)}" checked style="accent-color:var(--accent)" /> ${esc(genre)}`;
    wrap.append(label);
  });

  updatePosterPreview(data.poster || $("[name='poster']")?.value || "");
  const episodeCount = episodes ? applyImportedEpisodes(data) : 0;
  const statusEl = document.getElementById("editorStatus");
  if (statusEl) {
    const bits = ["Данные импортированы — не забудьте сохранить"];
    if (episodeCount) bits.push(`серий: ${episodeCount}`);
    const titles = Array.isArray(data.episodeList) ? data.episodeList.filter((ep) => ep?.title).length : 0;
    if (episodeCount && !titles) bits.push("названий серий в базах пока нет — впишите вручную");
    statusEl.textContent = bits.join(" · ");
  }
  const form = $("#animeForm");
  if (form) captureEditorValues();
}

function importedEpisodes(data) {
  const count = Math.min(200, Number(data.episodesCount) || 0);
  const list = Array.isArray(data.episodeList) ? data.episodeList : [];
  const duration = data.duration ? `${data.duration} мин` : "24 мин";
  /* Серий столько, сколько их всего, а названия подставляем там, где они известны. */
  const total = Math.min(120, Math.max(count, list.length));
  if (!total) return [];
  return Array.from({ length: total }, (_, index) => {
    const imported = list.find((ep) => Number(ep.number) === index + 1);
    return {
      id: uid("ep"),
      number: index + 1,
      title: imported?.title || "",
      date: imported?.date || "",
      duration,
      players: [],
    };
  });
}

/** Перерисовывает блок «Эпизоды и плееры» из editorModel. */
function renderEpisodesEditor() {
  const wrap = $("#episodeEditor");
  if (!wrap || !editorModel) return;
  wrap.innerHTML = editorModel.episodes.map((ep, i) => episodeEditorHTML(ep, i)).join("")
    || '<p class="muted small">Эпизодов нет. Нажмите «Эпизод».</p>';
  bindEpisodeControls();
}

/**
 * Подставляет серии из импорта: названия и количество с MyAnimeList.
 * Если у пользователя уже настроены плееры — дополняем, а не затираем.
 */
function applyImportedEpisodes(data) {
  if (!editorModel) return 0;
  const fresh = importedEpisodes(data);
  if (!fresh.length) return 0;
  const existing = Array.isArray(editorModel.episodes) ? editorModel.episodes : [];
  const hasPlayers = existing.some((ep) => (ep.players || []).some(
    (player) => player?.url || player?.code || (player?.type && player.type !== "demo"),
  ));
  if (!hasPlayers) {
    editorModel.episodes = fresh;
    renderEpisodesEditor();
    return fresh.length;
  }
  existing.forEach((ep, index) => {
    const imported = fresh[index];
    if (!imported) return;
    if (!ep.title && imported.title) ep.title = imported.title;
    if (!ep.date && imported.date) ep.date = imported.date;
  });
  for (let i = existing.length; i < fresh.length; i += 1) existing.push(fresh[i]);
  editorModel.episodes = existing;
  renderEpisodesEditor();
  return existing.length;
}

/** Переводит названия серий импортированной карточки на русский (если включено). */
async function withTranslatedTitles(data) {
  if (!data?.episodeList?.length) return data;
  if (draftCatalog.settings.translateEpisodes === false) return data;
  const titles = data.episodeList.map((ep) => ep.title).filter(Boolean);
  if (!titles.length) return data;
  try {
    const map = await sources.translateTitles(titles);
    return {
      ...data,
      episodeList: data.episodeList.map((ep) => {
        const translated = ep.title ? map[ep.title] : "";
        if (!translated || translated === ep.title) return ep;
        return { ...ep, title: translated, titleOriginal: ep.title };
      }),
    };
  } catch (error) {
    console.debug("translate:", error?.message);
    return data;
  }
}

/** Что реально подтянулось — показываем в тосте. */
function importSummary(data) {
  const parts = [];
  if (data.description) parts.push("описание");
  if (data.genres?.length) parts.push(`жанры (${data.genres.length})`);
  if (data.poster) parts.push("постер");
  if (data.banner) parts.push("баннер");
  const episodes = Array.isArray(data.episodeList) && data.episodeList.length
    ? data.episodeList.length
    : Number(data.episodesCount) || 0;
  if (episodes) parts.push(`эпизоды (${episodes})`);
  const sources = (data.report?.sources || []).filter(Boolean);
  const tail = sources.length ? ` · ${[...new Set(sources)].join(" + ")}` : "";
  return parts.length ? `Подтянуто: ${parts.join(", ")}${tail}` : "Данные импортированы";
}

function createAnimeFromImport(data) {
  const base = blankAnime();
  const title = String(data.title || "").trim() || "Без названия";
  const anime = {
    ...base,
    id: uniqueId(title),
    title,
    originalTitle: data.originalTitle || "",
    year: Number(data.year) || new Date().getFullYear(),
    status: STATUS_LABELS[data.status] ? data.status : "ongoing",
    genres: (data.genres || []).filter(Boolean),
    rating: Number(data.rating) || 0,
    ageRating: data.ageRating || "",
    description: data.description || "",
    poster: data.poster || "",
    banner: data.banner || "",
    shikimoriId: data.shikimoriId || "",
    malId: Number(data.malId) || 0,
    cvhId: "",
    studio: data.studio || "",
    country: data.country || "Япония",
    tags: (data.tags || []).filter(Boolean),
    aliases: (data.aliases || []).filter(Boolean),
    published: false,
    featured: false,
    createdAt: new Date().toISOString(),
    episodes: importedEpisodes(data),
  };
  if (!anime.episodes.length) anime.episodes = base.episodes;
  anime.genres.forEach((genre) => {
    if (!draftCatalog.genres.includes(genre)) draftCatalog.genres.push(genre);
  });
  draftCatalog.anime.unshift(anime);
  store.saveDraft(draftCatalog);
  return anime;
}

/**
 * Постер для уже существующей карточки: сначала Shikimori, затем AniList / MyAnimeList,
 * и только в крайнем случае — прямой URL по Shikimori ID.
 */
async function resolvePoster(anime) {
  let data = null;
  try {
    data = await fetchPosterSmart(anime);
  } catch (error) {
    console.debug("poster:", error?.message);
  }
  let poster = data?.poster && !data.fallback ? data.poster : "";
  let shikimoriId = data?.shikimoriId || anime.shikimoriId || "";
  if (!poster) {
    try {
      const full = await sources.enrich({ ...anime, poster: "" }, { withEpisodes: false });
      if (full?.poster) poster = full.poster;
      if (!shikimoriId && full?.shikimoriId) shikimoriId = full.shikimoriId;
    } catch (error) {
      console.debug("poster sources:", error?.message);
    }
  }
  if (!poster && shikimoriId) poster = posterUrlById(shikimoriId);
  return { poster, shikimoriId };
}

async function importByValue(value, { withEpisodes = false, source } = {}) {
  const parsed = sources.parseQuery(value);
  if (!parsed.id && !parsed.text) throw new Error("Пустой запрос");
  if (parsed.id) {
    return sources.importCandidate(
      { source: parsed.source || source || "shikimori", sourceId: parsed.id, title: "" },
      { kinopoiskToken: apiKeys().kinopoiskToken, withEpisodes },
    );
  }
  for (const query of queryVariants(parsed.text)) {
    try {
      const full = await sources.findShikimori(query);
      if (full) return sources.enrich(full, { withEpisodes });
    } catch (error) {
      console.debug("Shikimori search:", error?.message);
    }
  }
  const list = await sources.searchAniList(parsed.text, 1);
  if (!list.length) throw new Error("Ничего не найдено — попробуйте другое название");
  return sources.importCandidate(list[0], {
    kinopoiskToken: apiKeys().kinopoiskToken,
    withEpisodes,
  });
}

async function handlePosterFetch(btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Ищу…";
  try {
    if (editorModel) captureEditorValues();
    const model = editorModel || {};
    const query = model.shikimoriId || model.originalTitle || model.title;
    let data = null;
    if (query) {
      try {
        data = await importByValue(query);
      } catch (error) {
        console.debug("Импорт:", error?.message);
      }
    }
    if (!data) data = await fetchPosterSmart(model);
    if (!data || (!data.poster && !data.title)) throw new Error("Ничего не найдено");
    applyImportedFields(data);
    if (data.fallback) ui.toast("API недоступен — постер подставлен по ID", "info");
    else ui.toast("Карточка заполнена — проверьте поля и сохраните", "ok");
  } catch (error) {
    ui.toast(error?.message || "Не удалось получить данные", "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* Ключи API хранятся в браузере, а не в каталоге. */
function apiKeys() {
  const keys = store.getKeys();
  const settings = draftCatalog.settings || {};
  return {
    kinopoiskToken: String(keys.kinopoiskToken || "").trim(),
    kodikToken: String(keys.kodikToken || "").trim(),
    cvhToken: String(keys.cvhToken || "").trim(),
  };
}

/* ---------- Kodik: плееры озвучки ---------- */
function kodikSettings() {
  const settings = draftCatalog.settings || {};
  return {
    token: apiKeys().kodikToken,
    filter: String(settings.kodikTranslation || "Рабочая партия").trim().toLowerCase(),
    proxy: String(settings.corsProxy || "").trim(),
  };
}

function translationMatches(item, filter) {
  if (!filter) return true;
  const name = String(item?.translation?.title || "").toLowerCase();
  return name.includes(filter) || filter.includes(name) && name.length > 3;
}

/** Плееры Kodik для серии: тип iframe, ссылка на конкретную серию. */
function kodikPlayerOf(item, episode) {
  return {
    id: uid("pl"),
    name: item.translation?.title || "Kodik",
    type: "iframe",
    url: episode.link,
    code: "",
  };
}

/** Добавляет плеер в серию, если такого ещё нет. */
function attachPlayer(episodes, number, player) {
  let episode = episodes.find((ep) => Number(ep.number) === Number(number));
  if (!episode) {
    episode = { id: uid("ep"), number: Number(number), title: "", date: "", duration: "", players: [] };
    episodes.push(episode);
    episodes.sort((a, b) => Number(a.number) - Number(b.number));
  }
  if (!Array.isArray(episode.players)) episode.players = [];
  if (episode.players.some((existing) => existing.url === player.url)) return false;
  episode.players.push({ ...player, id: uid("pl") });
  return true;
}

/** Подтягивает плееры Kodik в текущую карточку. Возвращает { added, total }. */
async function attachKodikPlayers() {
  const { token, filter, proxy } = kodikSettings();
  if (!token || !editorModel) return { added: 0, total: 0, reason: "нет токена" };
  const results = await sources.kodikSearch({
    token,
    shikimoriId: editorModel.shikimoriId,
    title: editorModel.shikimoriId ? "" : (editorModel.originalTitle || editorModel.title),
    proxy,
  });
  const matched = results.filter((item) => translationMatches(item, filter));
  const episodes = Array.isArray(editorModel.episodes) ? editorModel.episodes : [];
  let added = 0;
  matched.forEach((item) => {
    item.episodes.forEach((episode) => {
      if (attachPlayer(episodes, episode.number, kodikPlayerOf(item, episode))) added += 1;
    });
  });
  if (added) {
    editorModel.episodes = episodes;
    renderEpisodesEditor();
  }
  return { added, total: results.length, matched: matched.length };
}

async function handleKodikPlayers(btn) {
  const { token } = kodikSettings();
  if (!token) {
    ui.toast("Сначала укажите токен Kodik в «Настройках сайта»", "err");
    return;
  }
  if (editorModel) captureEditorValues();
  if (!editorModel) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Ищу плееры…";
  try {
    const { added, total, matched } = await attachKodikPlayers();
    if (!total) {
      ui.toast("Kodik не знает этот тайтл", "err");
      return;
    }
    if (!matched) {
      ui.toast(`Найдено озвучек: ${total}, но «${draftCatalog.settings.kodikTranslation}» среди них нет`, "err");
      return;
    }
    const statusEl = document.getElementById("editorStatus");
    if (statusEl) statusEl.textContent = `Плееры Kodik: добавлено ${added} — не забудьте сохранить`;
    ui.toast(added ? `Добавлено плееров: ${added}` : "Все плееры уже на месте", added ? "ok" : "info");
  } catch (error) {
    ui.toast(error?.message || "Не удалось получить плееры Kodik", "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/** Авто-подстановка плееров и названий серий сразу после импорта: Kodik + CVH. */
async function autoKodikAfterImport() {
  if (draftCatalog.settings.autoPlayers === false) return;
  let added = 0;
  let titled = 0;
  const notes = [];

  try {
    const kodik = await attachKodikPlayers();
    added += kodik.added || 0;
    if (!kodik.total) notes.push("Kodik: тайтл не найден");
    else if (!kodik.matched) notes.push("Kodik: нет нужной озвучки");
  } catch (error) {
    notes.push(`Kodik: ${error?.message || "недоступен"}`);
  }

  try {
    const cvh = await attachCvhPlayers();
    added += cvh.added || 0;
    titled += cvh.titled || 0;
    if (cvh.reason) notes.push("CVH: нужен Shikimori ID");
    else if (cvh.total === 0) notes.push("CVH: тайтл не найден");
  } catch (error) {
    notes.push(`CVH: ${error?.message || "недоступен"}`);
  }

  if (titled && draftCatalog.settings.translateEpisodes !== false) {
    try { await translateEpisodeTitles(); } catch { /* перевод не критичен */ }
  }
  if (added || titled) renderEpisodesEditor();

  const statusEl = document.getElementById("editorStatus");
  const summary = `Плееров ${added}, названий серий ${titled}${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
  if (statusEl) statusEl.textContent = `Автоматически: ${summary}`;
  if (added || titled) ui.toast(`Автоматически: ${summary}`, "ok");
  else if (notes.length) ui.toast(summary, "err");
}

/* ---------- CVH: плееры озвучки ---------- */
function cvhSettings() {
  const settings = draftCatalog.settings || {};
  return {
    filter: String(settings.cvhTranslation || "Рабочая партия").trim().toLowerCase(),
    pub: String(settings.cvhPub || "747").trim(),
    aggr: String(settings.cvhAggr || "mali").trim(),
    proxy: String(settings.corsProxy || "").trim(),
  };
}

/** ID тайтла в CVH: он же MAL ID. Берём из карточки, из импорта или у Shikimori. */
async function cvhTitleId() {
  const fromField = String(editorModel?.cvhId || "").trim();
  if (/^\d+$/.test(fromField)) return fromField;
  const mal = Number(editorModel?.malId) || 0;
  if (mal) return String(mal);

  /* Старые карточки: MAL ID не сохранён — спрашиваем Shikimori. */
  const shikimori = String(editorModel?.shikimoriId || "").trim();
  if (/^\d+$/.test(shikimori)) {
    try {
      const data = await sources.getShikimori(shikimori);
      const resolved = Number(data?.malId) || 0;
      if (resolved) {
        editorModel.malId = resolved;
        editorModel.cvhId = editorModel.cvhId || String(resolved);
        return String(resolved);
      }
    } catch (error) {
      console.debug("MAL ID по Shikimori:", error?.message);
    }
  }
  return "";
}

/** Подтягивает плееры CVH нужной озвучки и названия серий. */
async function attachCvhPlayers() {
  const { filter, pub, aggr, proxy } = cvhSettings();
  const id = await cvhTitleId();
  if (!id || !editorModel) return { added: 0, titled: 0, reason: "нет ID" };

  const items = await sources.cvhPlaylist({ id, pub, aggr, proxy });
  const episodes = sources.cvhEpisodes(items, { translation: filter });
  const anyEpisode = episodes.length ? episodes : sources.cvhEpisodes(items, { translation: "" });
  if (!anyEpisode.length) return { added: 0, titled: 0, total: items.length };

  editorModel.cvhId = id;
  const list = Array.isArray(editorModel.episodes) ? editorModel.episodes : [];
  let added = 0;
  let titled = 0;
  anyEpisode.forEach((item) => {
    const player = {
      name: `CVH · ${item.studio || "озвучка"}`,
      type: "cvh",
      url: sources.cvhPlayerUrl(item.vkId),
      code: "",
    };
    if (attachPlayer(list, item.number, player)) added += 1;
    if (item.title) {
      const episode = list.find((ep) => Number(ep.number) === Number(item.number));
      if (episode && !episode.title) {
        episode.title = item.title;
        episode.titleOriginal = "";
        titled += 1;
      }
    }
  });
  if (added) editorModel.episodes = list;
  return { added, titled, total: items.length, matched: episodes.length };
}

async function handleCvhPlayers(btn) {
  if (editorModel) captureEditorValues();
  if (!editorModel) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Ищу плееры…";
  const id = await cvhTitleId();
  if (!id) {
    btn.disabled = false;
    btn.innerHTML = original;
    ui.toast("Укажите Shikimori ID или импортируйте тайтл — ID в CVH совпадает с MAL ID", "err");
    return;
  }
  try {
    const { added, titled, total } = await attachCvhPlayers();
    if (!total) {
      ui.toast("CVH не знает этот тайтл", "err");
      return;
    }
    if (titled && draftCatalog.settings.translateEpisodes !== false) await translateEpisodeTitles();
    renderEpisodesEditor();
    const statusEl = document.getElementById("editorStatus");
    if (statusEl) statusEl.textContent = `CVH: плееров ${added}, названий серий ${titled}`;
    ui.toast(`CVH: плееров ${added}, названий серий ${titled}`, added || titled ? "ok" : "info");
  } catch (error) {
    ui.toast(error?.message || "Не удалось получить плееры CVH", "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/** Переводит названия серий карточки на русский. */
async function translateEpisodeTitles() {
  if (!editorModel?.episodes?.length) return 0;
  const titles = editorModel.episodes.map((ep) => ep.title).filter(Boolean);
  if (!titles.length) return 0;
  const map = await sources.translateTitles(titles);
  let changed = 0;
  editorModel.episodes.forEach((ep) => {
    const translated = ep.title ? map[ep.title] : "";
    if (translated && translated !== ep.title) {
      ep.titleOriginal = ep.titleOriginal || ep.title;
      ep.title = translated;
      changed += 1;
    }
  });
  return changed;
}

/* ---------- Проверка ключей API ---------- */
async function handleCheckKeys(btn) {
  const statusEl = $("#keysStatus");
  const keys = apiKeys();
  const settings = draftCatalog.settings || {};
  const proxy = String(settings.corsProxy || "").trim();
  const say = (html) => { if (statusEl) statusEl.innerHTML = html; };
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Проверяю…";
  const lines = [];
  const line = (ok, text) => lines.push(`<div>${ok ? "✓" : "✗"} ${esc(text)}</div>`);
  try {
    if (!keys.kodikToken) line(false, "Kodik: токен не задан");
    else {
      const probes = await sources.probeKodik({ token: keys.kodikToken, proxy });
      probes.forEach((probe) => line(probe.ok, `Kodik ${probe.label}: ${probe.detail} (${probe.ms} мс)`));
      if (!probes.some((probe) => probe.ok)) {
        line(false, "Kodik: ни один путь не работает — включите VPN или впишите свой CORS-прокси");
      }
    }
    try {
      const items = await sources.cvhPlaylist({ id: "51019", pub: String(settings.cvhPub || "747").trim(), aggr: String(settings.cvhAggr || "mali").trim(), proxy });
      const studios = sources.cvhStudios(items);
      line(true, `CVH: ответ получен, серий ${items.length}, озвучек ${studios.length}`);
    } catch (error) {
      line(false, `CVH: ${error?.message || "ошибка запроса"}`);
    }
    if (!keys.kinopoiskToken) line(false, "Кинопоиск: токен не задан");
    else {
      try {
        const found = await sources.searchKinopoisk("Наруто", keys.kinopoiskToken, 1);
        line(true, `Кинопоиск: ответ получен, найдено ${found.length}`);
      } catch (error) {
        line(false, `Кинопоиск: ${error?.message || "ошибка запроса"}`);
      }
    }
    try {
      const shiki = await sources.getShikimori(61999);
      line(Boolean(shiki), `Shikimori: ${shiki ? `«${shiki.title}», MAL ID ${shiki.malId || "нет"}` : "ответ пустой"}`);
    } catch (error) {
      line(false, `Shikimori: ${error?.message || "ошибка запроса"}`);
    }
    try {
      const episodes = await sources.fetchEpisodes(61999, 1);
      const titled = episodes.filter((episode) => episode.title).length;
      line(episodes.length > 0, `MyAnimeList (Jikan): серий ${episodes.length}, с названиями ${titled}`);
    } catch (error) {
      line(false, `MyAnimeList (Jikan): ${error?.message || "недоступен из этой сети"}`);
    }
    try {
      const media = await sources.getAniListByMal(61999);
      line(Boolean(media), `AniList: ${media ? `«${media.title}»` : "ответ пустой"}`);
    } catch (error) {
      line(false, `AniList: ${error?.message || "ошибка запроса"}`);
    }
    try {
      const map = await sources.translateTitles(["The Mask of the War God"]);
      const translated = map["The Mask of the War God"] || "";
      line(Boolean(translated), `Перевод серий: ${translated || "сервис не ответил"}`);
    } catch (error) {
      line(false, `Перевод серий: ${error?.message || "ошибка"}`);
    }
    say(lines.join(""));
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/** Перевод названий серий на русский (для уже созданной карточки). */
async function handleTranslateTitles(btn) {
  if (editorModel) captureEditorValues();
  if (!editorModel?.episodes?.length) {
    ui.toast("Сначала добавьте серии", "err");
    return;
  }
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Перевожу…";
  try {
    const changed = await translateEpisodeTitles();
    if (!changed) {
      ui.toast("Переводить нечего: названий серий нет или они уже по-русски", "err");
      return;
    }
    renderEpisodesEditor();
    ui.toast(`Названий переведено: ${changed}`, "ok");
  } catch (error) {
    ui.toast(error?.message || "Не удалось перевести", "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function handleQuickImport(btn, candidate = null) {
  const input = $("#quickImport");
  const value = (input?.value || "").trim();
  if (!value && !candidate) {
    ui.toast("Введите ID, ссылку или название", "err");
    input?.focus();
    return;
  }
  const original = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "Ищу…";
  }
  const kinopoiskToken = apiKeys().kinopoiskToken;
  try {
    if (editorModel) captureEditorValues();

    /* Сначала мгновенно показываем данные выбранного источника (один запрос),
       затем дополняем их остальными базами — так ожидание чувствуется короче. */
    let base = null;
    if (candidate) {
      try {
        base = await sources.importBase(candidate, { kinopoiskToken });
        if (base) {
          applyImportedFields({ ...base, poster: base.poster || candidate.poster || "" }, { episodes: false });
          const statusEl = document.getElementById("editorStatus");
          if (statusEl) statusEl.textContent = "Основные данные подставлены — уточняю из других баз…";
        }
      } catch (error) {
        console.debug("importBase:", error?.message);
      }
    }

    const raw = base
      ? await sources.enrich(base, { kinopoiskToken, withEpisodes: true, fallback: candidate })
      : candidate
        ? await sources.importCandidate(candidate, { kinopoiskToken, withEpisodes: true })
        : await importByValue(value, { withEpisodes: true });
    const data = await withTranslatedTitles(raw);
    applyImportedFields(data);
    await autoKodikAfterImport();
    if (input) input.value = "";
    ui.toast(importSummary(data), "ok");
  } catch (error) {
    ui.toast(error?.message || "Не удалось импортировать", "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

/* Варианты запроса с учётом раскладки и транслита: «vfcrf dthvbkmjyf» → «маска вермильона» */
function queryVariants(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const forms = searchForms(text);
  const cyrillic = /[а-яё]/i.test(text) ? text : forms.find((form) => /[а-яё]/.test(form));
  return [...new Set([cyrillic, text].filter(Boolean))];
}

/* Поиск кандидатов для подсказок */
async function searchCandidates(value, source = "shikimori", limit = 6) {
  const parsed = sources.parseQuery(value);
  if (parsed.id) {
    const src = parsed.source || source;
    return [{
      source: src,
      sourceId: parsed.id,
      title: `${sources.SOURCE_LABELS[src] || src} · ID ${parsed.id}`,
      originalTitle: "",
      year: undefined,
      score: 0,
      kind: "",
      poster: src === "shikimori" ? posterUrlById(parsed.id) : "",
    }];
  }
  const text = parsed.text || value;
  if (source === "anilist") return sources.searchAniList(text, limit);
  if (source === "kinopoisk") return sources.searchKinopoisk(text, apiKeys().kinopoiskToken, limit);

  for (const query of queryVariants(text)) {
    try {
      const list = await sources.searchShikimori(query, limit);
      if (list.length) return list;
    } catch (error) {
      console.debug("Shikimori search:", error?.message);
    }
  }
  try {
    return await sources.searchAniList(text, limit);
  } catch (error) {
    console.debug("AniList search:", error?.message);
    return [];
  }
}

/* Подсказки под полем ввода */
function suggestItemHTML(item, index, active) {
  const poster = safeUrl(item.poster);
  const meta = [
    item.originalTitle,
    item.year,
    item.kind,
    item.score ? `★ ${Number(item.score).toFixed(1)}` : "",
    item.episodes ? `${item.episodes} эп.` : "",
  ].filter(Boolean).join(" · ");
  return `<button type="button" role="option" class="suggest-item${index === active ? " is-active" : ""}" data-suggest-index="${index}">
    <span class="suggest-poster" style="--h:${hueFrom(item.title || "anime")}">${poster ? `<img src="${attr(poster)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()" />` : ""}</span>
    <span class="suggest-text"><b>${esc(item.title || `ID ${item.sourceId}`)}</b><small>${esc(meta || "—")}</small></span>
  </button>`;
}

function attachSuggest({ input, box, search, onPick, delay = 320 }) {
  if (!input || !box) return;
  let items = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  const close = () => {
    box.hidden = true;
    box.innerHTML = "";
    items = [];
    active = -1;
  };

  const show = (list) => {
    items = list;
    active = list.length ? 0 : -1;
    box.innerHTML = list.length
      ? list.map((item, index) => suggestItemHTML(item, index, active)).join("")
      : `<div class="suggest-empty">Ничего не найдено</div>`;
    box.hidden = false;
  };

  const highlight = () => {
    box.querySelectorAll(".suggest-item").forEach((el, index) => {
      el.classList.toggle("is-active", index === active);
    });
  };

  const run = async (value) => {
    const mySeq = ++seq;
    box.hidden = false;
    box.innerHTML = `<div class="suggest-empty">Ищу варианты…</div>`;
    try {
      const list = await search(value);
      if (mySeq !== seq) return;
      show(list.slice(0, 6));
    } catch (error) {
      if (mySeq !== seq) return;
      items = [];
      box.innerHTML = `<div class="suggest-empty">${esc(error?.message || "Ошибка поиска")}</div>`;
    }
  };

  input.addEventListener("input", () => {
    const value = input.value.trim();
    clearTimeout(timer);
    seq += 1;
    if (value.length < 2) { close(); return; }
    timer = setTimeout(() => run(value), delay);
  });

  input.addEventListener("keydown", (event) => {
    if (box.hidden) return;
    if (event.key === "ArrowDown") {
      if (!items.length) return;
      event.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      highlight();
    } else if (event.key === "ArrowUp") {
      if (!items.length) return;
      event.preventDefault();
      active = Math.max(0, active - 1);
      highlight();
    } else if (event.key === "Enter") {
      if (!items[active]) return;
      event.preventDefault();
      const picked = items[active];
      close();
      onPick(picked);
    } else if (event.key === "Escape") {
      close();
    }
  });

  box.addEventListener("mousedown", (event) => {
    const btn = event.target.closest("[data-suggest-index]");
    if (!btn) return;
    event.preventDefault();
    const picked = items[Number(btn.dataset.suggestIndex)];
    close();
    if (picked) onPick(picked);
  });

  input.addEventListener("blur", () => setTimeout(close, 180));
}

function bindEditor(anime, isNew) {
  bindEpisodeControls();
  $("#addEpisode")?.addEventListener("click", addEpisode);

  $("#kodikPlayers")?.addEventListener("click", (event) => handleKodikPlayers(event.currentTarget));
  $("#cvhPlayers")?.addEventListener("click", (event) => handleCvhPlayers(event.currentTarget));
  $("#translateTitles")?.addEventListener("click", (event) => handleTranslateTitles(event.currentTarget));

  /* Массовая вставка названий серий: базы данных у новых тайтлов их ещё не знают. */
  $("#bulkEpisodeTitles")?.addEventListener("click", () => {
    const box = $("#bulkTitles");
    if (!box) return;
    box.hidden = !box.hidden;
    if (!box.hidden) $("#bulkTitlesInput")?.focus();
  });
  $("#bulkTitlesCancel")?.addEventListener("click", () => {
    const box = $("#bulkTitles");
    if (box) box.hidden = true;
  });
  $("#bulkTitlesApply")?.addEventListener("click", () => {
    const textarea = $("#bulkTitlesInput");
    const lines = String(textarea?.value || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      ui.toast("Вставьте названия — по одному в строке", "err");
      return;
    }
    captureEditorValues();
    if (!editorModel) return;
    lines.forEach((title, index) => {
      const episode = editorModel.episodes[index];
      if (episode) episode.title = title;
    });
    renderEpisodesEditor();
    const box = $("#bulkTitles");
    if (box) box.hidden = true;
    ui.toast(`Названия подставлены: ${Math.min(lines.length, editorModel.episodes.length)}`, "ok");
  });

  $("#fetchPoster")?.addEventListener("click", (event) => handlePosterFetch(event.currentTarget));
  $("#quickImportBtn")?.addEventListener("click", (event) => handleQuickImport(event.currentTarget));
  attachSuggest({
    input: $("#quickImport"),
    box: $("#quickSuggest"),
    search: (value) => searchCandidates(value, "shikimori"),
    onPick: (item) => handleQuickImport($("#quickImportBtn"), item),
  });
  $("#f-poster")?.addEventListener("input", (event) => updatePosterPreview(event.target.value));

  // загрузка изображений в data URL
  $$("[data-upload]").forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) { ui.toast("Нужен файл изображения", "err"); return; }
      if (file.size > 900 * 1024) { ui.toast("Файл больше 900 КБ — используйте ссылку", "err"); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const target = $(`[name="${input.dataset.upload}"]`);
        if (target) {
          target.value = String(reader.result);
          ui.toast("Изображение вставлено в поле", "ok");
        }
      };
      reader.readAsDataURL(file);
    });
  });

  $("#animeForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditor();
  });

  // подсказка о несохранённых изменениях
  const form = $("#animeForm");
  form?.addEventListener("input", () => {
    const status = $("#editorStatus");
    if (status) status.textContent = "Есть несохранённые изменения";
  });

  /* Карточка без плееров (например, только что из импорта) — сразу подставляем
     плееры нужной озвучки, если это включено в настройках. */
  const hasPlayers = (editorModel?.episodes || [])
    .some((ep) => (ep.players || []).some((pl) => pl.type !== "demo" && (pl.url || pl.code)));
  if (!hasPlayers && draftCatalog.settings.autoPlayers !== false) {
    setTimeout(() => autoKodikAfterImport(), 250);
  }

  void anime;
  void isNew;
}

/* ======================================================================
   Импорт из внешних баз
   ====================================================================== */
function importResultsHTML(items) {
  if (!items.length) {
    return `<div class="panel"><div class="empty" style="border:0;background:none">Ничего не найдено. Попробуйте другое название или источник.</div></div>`;
  }
  const cards = items.map((item) => {
    const poster = safeUrl(item.poster);
    const meta = [
      item.originalTitle,
      item.year,
      item.kind,
      item.score ? `★ ${Number(item.score).toFixed(1)}` : "",
      item.episodes ? `${item.episodes} эп.` : "",
    ].filter(Boolean).join(" · ");
    return `<article class="import-card">
      <div class="import-poster" style="--h:${hueFrom(item.title || "anime")}">
        ${poster ? `<img src="${attr(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ""}
      </div>
      <div class="import-info">
        <b>${esc(item.title || `ID ${item.sourceId}`)}</b>
        <small class="muted">${esc(meta || "—")}</small>
      </div>
      <button class="btn btn-sm" type="button" data-import-source="${attr(item.source)}"
        data-import-id="${attr(item.sourceId)}" data-import-title="${attr(item.title || "")}">
        ${ui.icon("download")} Импортировать
      </button>
    </article>`;
  }).join("");

  return `<div class="panel">
    <div class="panel-head"><div><h2>Найдено · ${items.length}</h2><p>Выберите тайтл — карточка создастся в черновике и сразу откроется редактор.</p></div></div>
    <div class="import-list">${cards}</div>
  </div>`;
}

/** Добавляет плееры Kodik ко всем тайтлам выбранной озвучки. */
async function handleKodikSync(btn) {
  const { token, filter, proxy } = kodikSettings();
  const statusEl = $("#kodikStatus");
  if (!token) {
    ui.toast("Сначала укажите токен Kodik в «Настройках сайта»", "err");
    return;
  }
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Синхронизирую…";
  const say = (text) => { if (statusEl) statusEl.textContent = text; };
  try {
    say("Ищу озвучку в Kodik…");
    const translations = await sources.kodikTranslations({ token, proxy });
    const found = translations.filter((item) => item.title.toLowerCase().includes(filter));
    if (!found.length) {
      const sample = translations.slice(0, 8).map((item) => item.title).join(", ");
      say(`Озвучка «${draftCatalog.settings.kodikTranslation}» не найдена. В Kodik есть, например: ${sample || "—"}`);
      return;
    }
    say(`Озвучка: ${found.map((item) => item.title).join(", ")}. Загружаю список тайтлов…`);

    const items = await sources.kodikList({ token, translationId: found[0].id, proxy });
    say(`Тайтлов у озвучки: ${items.length}. Раскладываю по каталогу…`);

    let created = 0;
    let updated = 0;
    items.forEach((item) => {
      const existing = draftCatalog.anime.find((anime) => (
        (item.shikimoriId && String(anime.shikimoriId) === item.shikimoriId)
        || (item.title && anime.title.toLowerCase() === item.title.toLowerCase())
      ));
      if (existing) {
        const episodes = Array.isArray(existing.episodes) ? existing.episodes : [];
        let added = 0;
        item.episodes.forEach((episode) => {
          if (attachPlayer(episodes, episode.number, kodikPlayerOf(item, episode))) added += 1;
        });
        existing.episodes = episodes;
        if (!existing.shikimoriId && item.shikimoriId) existing.shikimoriId = item.shikimoriId;
        if (added) updated += 1;
        return;
      }
      const base = blankAnime();
      const episodes = item.episodes.map((episode) => ({
        id: uid("ep"),
        number: episode.number,
        title: "",
        date: "",
        duration: "",
        players: [kodikPlayerOf(item, episode)],
      }));
      draftCatalog.anime.unshift({
        ...base,
        id: uniqueId(item.title || "anime"),
        title: item.title || "Без названия",
        originalTitle: item.originalTitle || "",
        year: item.year || new Date().getFullYear(),
        shikimoriId: item.shikimoriId || "",
        poster: item.shikimoriId ? posterUrlById(item.shikimoriId) : "",
        published: false,
        createdAt: new Date().toISOString(),
        episodes: episodes.length ? episodes : base.episodes,
      });
      created += 1;
    });

    store.saveDraft(draftCatalog);
    say(`Готово: новых карточек ${created}, дополнено плеерами ${updated}. Дальше — проверьте и опубликуйте.`);
    ui.toast(`Kodik: +${created} карточек, ${updated} обновлено`, created || updated ? "ok" : "info");
    ctx?.refresh?.();
  } catch (error) {
    say(error?.message || "Синхронизация не удалась");
    ui.toast(error?.message || "Синхронизация не удалась", "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function importTab() {
  const s = draftCatalog.settings;
  return `<div class="stack" style="--gap:16px">
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Импорт из внешних баз</h2>
          <p>Введите название, ссылку или ID — данные подтянутся автоматически: название на русском, оригинал, описание, жанры, рейтинг, возраст, студия, постер, баннер, количество серий и названия серий.</p>
          <p class="hint" style="margin-top:6px">Недостающее добирается из других баз: если на Shikimori нет постера или жанров — возьмём с AniList, названия серий — с MyAnimeList (Jikan). Источники можно комбинировать, данные склеиваются в одну карточку.</p>
        </div>
      </div>
      <form id="importForm" class="field-row" style="align-items:flex-end;gap:10px;flex-wrap:wrap">
        <div class="field" style="flex:1 1 260px;margin:0">
          <label for="importQuery">Название, ссылка или ID</label>
          <div class="suggest-wrap">
            <input id="importQuery" name="query" type="search" placeholder="Атака титанов, 16498 или ссылка на Shikimori" autocomplete="off" />
            <div class="suggest" id="importSuggest" hidden></div>
          </div>
        </div>
        <div class="field" style="flex:0 1 190px;margin:0">
          <label for="importSource">Источник</label>
          <select id="importSource" name="source">
            <option value="shikimori">Shikimori — рус.</option>
            <option value="anilist">AniList</option>
            <option value="kinopoisk">Кинопоиск</option>
          </select>
        </div>
        <label class="switch" style="margin-bottom:8px;white-space:nowrap">
          <input type="checkbox" id="importEpisodes" checked /><span class="track"></span> Эпизоды
        </label>
        <button class="btn" type="submit">${ui.icon("search")} Найти</button>
      </form>
      <p class="hint" style="margin-top:10px">
        Shikimori и AniList работают без ключей и отдают CORS. Кинопоиску нужен токен из «Настроек сайта»
        ${apiKeys().kinopoiskToken ? "(токен уже сохранён)" : ""}; если браузер заблокирует запрос к нему — используйте Shikimori.
      </p>
    </div>
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Синхронизация с Kodik</h2>
          <p>Находит тайтлы, у которых в Kodik есть озвучка «${esc(s.kodikTranslation || "Рабочая партия")}», и создаёт карточки с готовыми плеерами по сериям. Уже существующие карточки дополняются плеерами.</p>
        </div>
        <button class="btn" type="button" id="kodikSync">${ui.icon("download")} Синхронизировать</button>
      </div>
      <p class="hint" id="kodikStatus">${apiKeys().kodikToken ? "Токен Kodik сохранён." : "Нужен токен Kodik API — добавьте его в «Настройки сайта»."}</p>
    </div>
    <div id="importResults"></div>
  </div>`;
}

function bindImportTab() {
  const form = $("#importForm");
  const results = $("#importResults");
  if (!form || !results) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = String(form.elements.query?.value || "").trim();
    if (!value) return;
    const source = form.elements.source?.value || "shikimori";
    const button = form.querySelector("button[type='submit']");
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = "Ищу…";
    results.innerHTML = `<div class="panel"><p class="muted">Запрашиваю ${esc(sources.SOURCE_LABELS[source] || source)}…</p></div>`;

    try {
      const items = await searchCandidates(value, source, 10);
      results.innerHTML = importResultsHTML(items);
    } catch (error) {
      results.innerHTML = `<div class="panel"><div class="notice">${ui.icon("info")}<div>${esc(error?.message || "Ошибка запроса")}</div></div></div>`;
      ui.toast(error?.message || "Не удалось выполнить поиск", "err");
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });

  const importPicked = async (candidate) => {
    try {
      const raw = await sources.importCandidate(candidate, {
        kinopoiskToken: apiKeys().kinopoiskToken,
        withEpisodes: Boolean($("#importEpisodes")?.checked),
      });
      const data = await withTranslatedTitles(raw);
      const created = createAnimeFromImport(data);
      ui.toast(`«${created.title}» добавлено в черновик — ${importSummary(data).toLowerCase()}`, "ok");
      goAdmin(`#/admin/edit/${created.id}`);
    } catch (error) {
      ui.toast(error?.message || "Не удалось импортировать", "err");
    }
  };

  results.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-import-id]");
    if (!btn) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "Импортирую…";
    await importPicked({
      source: btn.dataset.importSource,
      sourceId: btn.dataset.importId,
      title: btn.dataset.importTitle || "",
    });
    btn.disabled = false;
    btn.innerHTML = original;
  });

  $("#kodikSync")?.addEventListener("click", (event) => handleKodikSync(event.currentTarget));

  attachSuggest({
    input: $("#importQuery"),
    box: $("#importSuggest"),
    search: (value) => searchCandidates(value, $("#importSource")?.value || "shikimori"),
    onPick: importPicked,
  });
}

/* ======================================================================
   Жанры
   ====================================================================== */
function genresTab() {
  return `<div class="panel">
    <div class="panel-head">
      <div><h2>Жанры · ${draftCatalog.genres.length}</h2><p>Жанры используются в фильтрах каталога и карточках аниме.</p></div>
      <form id="genreAdd" class="field-row">
        <input type="text" name="genre" placeholder="Новый жанр" style="min-height:38px;padding:8px 12px;border-radius:99px;border:1px solid var(--line);background:var(--surface-2)" />
        <button class="btn btn-sm" type="submit">${ui.icon("plus")} Добавить</button>
      </form>
    </div>
    <div class="stack" style="--gap:8px">
      ${draftCatalog.genres.map((genre, index) => {
        const count = draftCatalog.anime.filter((a) => a.genres.includes(genre)).length;
        return `<div class="row-between" style="padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)" data-genre-row="${attr(genre)}">
          <div class="field-row">
            <input value="${attr(genre)}" data-genre-input="${index}" style="min-height:36px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);min-width:180px" />
            <span class="muted small">${count} ${count === 1 ? "тайтл" : "тайтлов"}</span>
          </div>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm" type="button" data-genre-save="${index}">${ui.icon("save")} Переименовать</button>
            <button class="btn btn-ghost btn-sm" type="button" data-genre-remove="${attr(genre)}">${ui.icon("trash")}</button>
          </div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function bindGenresTab() {
  const persist = () => {
    try { store.saveDraft(draftCatalog); ui.toast("Жанры сохранены", "ok"); }
    catch (error) { ui.toast(error.message, "err"); }
  };

  $("#genreAdd")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = event.target.elements.genre;
    const value = input.value.trim();
    if (!value) return;
    if (draftCatalog.genres.includes(value)) { ui.toast("Такой жанр уже есть", "err"); return; }
    draftCatalog.genres.push(value);
    persist();
    ctx.refresh();
  });

  $$("[data-genre-save]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.genreSave);
      const oldGenre = draftCatalog.genres[index];
      const input = $(`[data-genre-input="${index}"]`);
      const next = input.value.trim();
      if (!next) { ui.toast("Название не может быть пустым", "err"); return; }
      if (next !== oldGenre && draftCatalog.genres.includes(next)) { ui.toast("Такой жанр уже есть", "err"); return; }
      draftCatalog.genres[index] = next;
      draftCatalog.anime.forEach((anime) => {
        anime.genres = Array.from(new Set(anime.genres.map((g) => (g === oldGenre ? next : g))));
      });
      persist();
      ctx.refresh();
    });
  });

  $$("[data-genre-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const genre = btn.dataset.genreRemove;
      if (!window.confirm(`Удалить жанр «${genre}»? Он исчезнет из карточек аниме.`)) return;
      draftCatalog.genres = draftCatalog.genres.filter((g) => g !== genre);
      draftCatalog.anime.forEach((anime) => {
        anime.genres = anime.genres.filter((g) => g !== genre);
      });
      persist();
      ctx.refresh();
    });
  });
}

/* ======================================================================
   Настройки сайта
   ====================================================================== */
function settingsTab() {
  const keys = store.getKeys();
  const s = draftCatalog.settings;
  return `<form class="stack" id="settingsForm" style="--gap:18px">
    <div class="panel">
      <div class="panel-head">
        <div><h2>Брендинг и тексты</h2><p>Название команды, подпись, описание и логотип.</p></div>
        <button class="btn btn-sm" type="submit">${ui.icon("save")} Сохранить</button>
      </div>
      <div class="form-grid">
        ${settingsInput("siteName", "Название сайта", s.siteName)}
        ${settingsInput("tagline", "Подпись под названием", s.tagline)}
        ${settingsInput("logo", "Логотип", s.logo, "Ссылка на картинку, эмодзи или 1–2 символа. Пусто = звезда.")}
        ${settingsInput("footerText", "Текст в подвале", s.footerText)}
        <div class="field span-2">
          <label for="s-description">Краткое описание сайта <small>для главной и мета-тегов</small></label>
          <textarea id="s-description" name="description" rows="3">${esc(s.description)}</textarea>
        </div>
        ${settingsInput("aboutTitle", "Заголовок страницы «О проекте»", s.aboutTitle)}
        <div class="field span-2">
          <label for="s-aboutText">Текст страницы «О проекте» <small>пусто — будет краткое описание</small></label>
          <textarea id="s-aboutText" name="aboutText" rows="5">${esc(s.aboutText)}</textarea>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Импорт из внешних баз</h2><p>Shikimori и AniList работают без ключей. Для Кинопоиска нужен бесплатный токен с kinopoisk.dev.</p></div>
      </div>
      <div class="form-grid">
        <div class="field span-2">
          <div class="keys-head">
            <div>
              <label>Ключи API</label>
              <p class="hint">Ключи хранятся только в этом браузере (localStorage) и никогда не публикуются в catalog.json. На других устройствах их нужно ввести заново.</p>
            </div>
            <button class="btn btn-soft btn-sm" type="button" id="checkKeys">${ui.icon("check")} Проверить ключи</button>
          </div>
          <div id="keysStatus" class="hint"></div>
        </div>
        <div class="field span-2">
          <label for="s-kinopoisk">Токен Кинопоиска (X-API-KEY)</label>
          <input id="s-kinopoisk" name="kinopoiskToken" type="text" value="${attr(keys.kinopoiskToken || "")}" placeholder="например: 5TXZNZC-…" autocomplete="off" />
          <p class="hint">Бесплатный тариф — 200 запросов в сутки: импорт по Кинопоиску включайте только когда действительно нужен.</p>
        </div>
        <div class="field span-2">
          <label for="s-kodik">Токен Kodik API <small>для авто-плееров</small></label>
          <input id="s-kodik" name="kodikToken" type="text" value="${attr(keys.kodikToken || "")}" placeholder="токен партнёра kodikapi.com" autocomplete="off" />
          <p class="hint">С токеном админка сама подставляет плееры нужной озвучки в серии и умеет синхронизировать каталог с Kodik.</p>
        </div>
        <div class="field">
          <label for="s-kodik-translation">Озвучка в Kodik</label>
          <input id="s-kodik-translation" name="kodikTranslation" type="text" value="${attr(s.kodikTranslation || "Рабочая партия")}" placeholder="Рабочая партия" autocomplete="off" />
          <p class="hint">Фильтр по названию озвучки — подставляются только её плееры.</p>
        </div>
        <div class="field">
          <label for="s-cvh-translation">Озвучка в CVH</label>
          <input id="s-cvh-translation" name="cvhTranslation" type="text" value="${attr(s.cvhTranslation || "Рабочая партия")}" placeholder="Рабочая партия" autocomplete="off" />
          <p class="hint">CVH (CDNVideoHub) — плеер, который использует Shikimori.</p>
        </div>
        <div class="field">
          <label for="s-cvh-pub">Партнёрский ID CVH <small>pub</small></label>
          <input id="s-cvh-pub" name="cvhPub" type="text" value="${attr(s.cvhPub || "747")}" placeholder="747" autocomplete="off" />
          <p class="hint">Из личного кабинета partners.cdnvideohub.com.</p>
        </div>
        <div class="field">
          <label for="s-cvh-aggr">Агрегатор CVH <small>aggr</small></label>
          <input id="s-cvh-aggr" name="cvhAggr" type="text" value="${attr(s.cvhAggr || "mali")}" placeholder="mali" autocomplete="off" />
          <p class="hint">Обычно <code>mali</code>; если CVH не отвечает — уточните в кабинете.</p>
        </div>
        <div class="field span-2">
          <label for="s-cvh-token">Токен CVH Partners <small>необязательно</small></label>
          <input id="s-cvh-token" name="cvhToken" type="text" value="${attr(keys.cvhToken || "")}" placeholder="JWT из личного кабинета" autocomplete="off" />
          <p class="hint">Нужен только для закрытых методов кабинета; плееры работают и без него.</p>
        </div>
        <div class="field">
          <label for="s-cors-proxy">CORS-прокси <small>необязательно</small></label>
          <input id="s-cors-proxy" name="corsProxy" type="text" value="${attr(s.corsProxy || "")}" placeholder="https://api.allorigins.win/raw?url=" autocomplete="off" />
          <p class="hint">Если браузер блокирует ответ Kodik или CVH, запрос пойдёт через прокси.</p>
        </div>
        <div class="field">
          <label class="switch"><input type="checkbox" name="translateEpisodes" ${s.translateEpisodes !== false ? "checked" : ""} /><span class="track"></span> Переводить названия серий на русский</label>
        </div>
        <div class="field">
          <label class="switch"><input type="checkbox" name="autoPlayers" ${s.autoPlayers !== false ? "checked" : ""} /><span class="track"></span> Подтягивать плееры Kodik сразу при импорте</label>
        </div>
        <div class="field span-2">
          <label class="switch"><input type="checkbox" name="kodikAuto" ${s.kodikAuto !== false ? "checked" : ""} /><span class="track"></span> Публиковать на сайте всё, что залито в плееры нужной озвучки</label>
          <p class="hint">Сайт сам подтягивает из Kodik тайтлы озвучки и показывает их в каталоге (кэш 6 часов). Ничего не коммитится — обновляется у каждого зрителя.</p>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Оформление</h2><p>Акцентные цвета и тема по умолчанию. Всё остальное — в CSS-переменных.</p></div></div>
      <div class="form-grid">
        <div class="field">
          <label for="s-accent">Акцентный цвет</label>
          <input id="s-accent" name="accent" type="color" value="${attr(s.accent)}" />
        </div>
        <div class="field">
          <label for="s-accent2">Второй цвет (градиенты)</label>
          <input id="s-accent2" name="accent2" type="color" value="${attr(s.accent2)}" />
        </div>
        ${settingsSelect("theme", "Тема по умолчанию", s.theme, [["dark", "Тёмная"], ["light", "Светлая"]])}
        ${settingsSelect("heroMode", "Что показывать в шапке главной", s.heroMode, [["featured", "Выбранное аниме (флажок «на главной»)"], ["newest", "Самое новое"]])}
        <div class="field span-2">
          <label class="switch"><input type="checkbox" name="continueWatching" ${s.continueWatching ? "checked" : ""} /><span class="track"></span> Показывать блок «Продолжить просмотр»</label>
        </div>
        <div class="field span-2">
          <label for="s-playerNote">Заметка под плеером <small>например, предупреждение о рекламе</small></label>
          <input id="s-playerNote" name="playerNote" value="${attr(s.playerNote)}" placeholder="Необязательно" />
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Объявление</h2><p>Бегущая строка под шапкой сайта.</p></div></div>
      <div class="form-grid">
        <div class="field span-2">
          <label class="switch"><input type="checkbox" name="announceEnabled" ${s.announcement.enabled ? "checked" : ""} /><span class="track"></span> Показывать объявление</label>
        </div>
        <div class="field span-2">
          <label for="s-announceText">Текст</label>
          <input id="s-announceText" name="announceText" value="${attr(s.announcement.text)}" />
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Соцсети</h2><p>Пустые поля не отображаются. Можно указать любой URL.</p></div></div>
      <div class="form-grid">
        ${settingsInput("socialTelegram", "Telegram", s.socials.telegram, "", "url")}
        ${settingsInput("socialDiscord", "Discord", s.socials.discord, "", "url")}
        ${settingsInput("socialVk", "ВКонтакте", s.socials.vk, "", "url")}
        ${settingsInput("socialYoutube", "YouTube", s.socials.youtube, "", "url")}
        ${settingsInput("socialGithub", "GitHub", s.socials.github, "", "url")}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Меню сайта</h2><p>Пункты верхнего меню и подвала. Ссылки — внутренние (<code>#/catalog</code>) или внешние.</p></div>
        <button class="btn btn-soft btn-sm" type="button" id="addNavItem">${ui.icon("plus")} Пункт</button>
      </div>
      <div class="stack" style="--gap:8px" id="navEditor">
        ${s.nav.map((item, i) => `<div class="row-between" data-nav-row="${i}" style="padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)">
          <div class="field-row" style="flex:1 1 auto">
            <input data-nav-label value="${attr(item.label)}" placeholder="Название" style="min-height:36px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);min-width:130px" />
            <input data-nav-href value="${attr(item.href)}" placeholder="#/catalog" style="min-height:36px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);min-width:160px" />
            <label class="switch"><input type="checkbox" data-nav-enabled ${item.enabled !== false ? "checked" : ""} /><span class="track"></span> вкл.</label>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-nav-remove="${i}">${ui.icon("trash")}</button>
        </div>`).join("")}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Свой CSS</h2><p>Тонкая настройка внешнего вида. Применяется сразу после сохранения.</p></div></div>
      <div class="field">
        <textarea name="customCss" rows="10" spellcheck="false" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem" placeholder=".hero-title { letter-spacing: -.04em; }">${esc(s.customCss)}</textarea>
      </div>
    </div>

    <div class="sticky-actions">
      <span class="status" id="settingsStatus">Настройки применяются после сохранения</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" type="submit">${ui.icon("save")} Сохранить настройки</button>
    </div>
  </form>`;
}

function settingsInput(name, label, value, hint = "", type = "text") {
  return `<div class="field">
    <label for="s-${name}">${esc(label)}${hint ? ` <small>${esc(hint)}</small>` : ""}</label>
    <input id="s-${name}" name="${name}" type="${type}" value="${attr(value)}" />
  </div>`;
}

function settingsSelect(name, label, value, options) {
  return `<div class="field">
    <label for="s-${name}">${esc(label)}</label>
    <select id="s-${name}" name="${name}">
      ${options.map(([val, text]) => `<option value="${attr(val)}"${val === value ? " selected" : ""}>${esc(text)}</option>`).join("")}
    </select>
  </div>`;
}

function collectNav() {
  return $$("#navEditor [data-nav-row]").map((row) => ({
    label: row.querySelector("[data-nav-label]")?.value.trim() || "Ссылка",
    href: row.querySelector("[data-nav-href]")?.value.trim() || "#/",
    enabled: row.querySelector("[data-nav-enabled]")?.checked !== false,
  }));
}

function bindSettingsTab() {
  const form = $("#settingsForm");
  const navEditor = $("#navEditor");
  const status = $("#settingsStatus");

  form?.addEventListener("input", () => { if (status) status.textContent = "Есть несохранённые изменения"; });

  $("#addNavItem")?.addEventListener("click", () => {
    const nav = collectNav();
    nav.push({ label: "Новый пункт", href: "#/catalog", enabled: true });
    draftCatalog.settings.nav = nav;
    store.saveDraft(draftCatalog);
    ctx.refresh();
  });

  $$("[data-nav-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nav = collectNav();
      nav.splice(Number(btn.dataset.navRemove), 1);
      draftCatalog.settings.nav = nav;
      store.saveDraft(draftCatalog);
      ctx.refresh();
    });
  });

  $("#checkKeys")?.addEventListener("click", (event) => handleCheckKeys(event.currentTarget));

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const get = (name) => form.elements[name]?.value ?? "";
    store.saveKeys({
      kinopoiskToken: get("kinopoiskToken").trim(),
      kodikToken: get("kodikToken").trim(),
      cvhToken: get("cvhToken").trim(),
    });
    draftCatalog.settings = {
      ...draftCatalog.settings,
      siteName: get("siteName").trim() || "Аниме-портал",
      kodikTranslation: get("kodikTranslation").trim() || "Рабочая партия",
      cvhTranslation: get("cvhTranslation").trim() || "Рабочая партия",
      cvhPub: get("cvhPub").trim() || "747",
      cvhAggr: get("cvhAggr").trim() || "mali",
      corsProxy: get("corsProxy").trim(),
      translateEpisodes: Boolean(form.elements.translateEpisodes?.checked),
      autoPlayers: Boolean(form.elements.autoPlayers?.checked),
      kodikAuto: Boolean(form.elements.kodikAuto?.checked),
      tagline: get("tagline").trim(),
      logo: get("logo").trim(),
      footerText: get("footerText").trim(),
      description: get("description").trim(),
      aboutTitle: get("aboutTitle").trim() || "О проекте",
      aboutText: get("aboutText").trim(),
      accent: get("accent") || "#f43f5e",
      accent2: get("accent2") || "#8b5cf6",
      theme: get("theme"),
      heroMode: get("heroMode"),
      continueWatching: form.elements.continueWatching.checked,
      playerNote: get("playerNote").trim(),
      customCss: get("customCss"),
      announcement: {
        enabled: form.elements.announceEnabled.checked,
        text: get("announceText"),
      },
      socials: {
        telegram: get("socialTelegram").trim(),
        discord: get("socialDiscord").trim(),
        vk: get("socialVk").trim(),
        youtube: get("socialYoutube").trim(),
        github: get("socialGithub").trim(),
      },
      nav: collectNav(),
    };
    try {
      store.saveDraft(draftCatalog);
      ui.toast("Настройки сохранены", "ok");
      if (status) status.textContent = "Сохранено";
      ctx.refresh();
    } catch (error) {
      ui.toast(error.message, "err");
    }
  });

  void navEditor;
}

/* ======================================================================
   Публикация и доступ
   ====================================================================== */
function publishTab() {
  const state = store.getState();
  const json = store.exportJSON(draftCatalog);
  const size = new Blob([json]).size;
  return `<div class="stack" style="--gap:18px">
    <div class="notice">
      ${ui.icon("info")}
      <div><strong>Как это работает.</strong> GitHub Pages — статический хостинг, поэтому админка сохраняет правки в localStorage этого браузера.
      Чтобы изменения увидели все посетители, скачайте <code>catalog.json</code> и замените им файл <code>data/catalog.json</code> в репозитории — сайт обновится автоматически.</div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Шаг 1. Выгрузить каталог</h2><p>Файл содержит настройки сайта, жанры и все аниме с плеерами.</p></div>
        <div class="row-actions">
          <button class="btn btn-sm" type="button" id="downloadJson">${ui.icon("download")} Скачать catalog.json</button>
          <button class="btn btn-ghost btn-sm" type="button" id="copyJson">${ui.icon("copy")} Скопировать</button>
        </div>
      </div>
      <div class="field">
        <textarea id="jsonOut" rows="14" readonly spellcheck="false" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem">${esc(json)}</textarea>
        <p class="hint">Размер: ${(size / 1024).toFixed(1)} КБ · записей: ${draftCatalog.anime.length} · источник: ${state.source === "draft" ? "черновик" : "data/catalog.json"}${state.draftSavedAt ? ` · сохранено ${esc(formatDate(state.draftSavedAt))}` : ""}</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Шаг 2. Заменить файл в репозитории</h2><p>Через веб-интерфейс GitHub или командой в терминале.</p></div></div>
      <ol class="stack" style="--gap:8px;padding-left:20px;list-style:decimal;color:var(--text-soft);font-size:.88rem">
        <li>Откройте репозиторий на GitHub → папка <code>data</code> → <code>catalog.json</code>.</li>
        <li>Нажмите «Edit» (карандаш), удалите старое содержимое и вставьте JSON из поля выше.</li>
        <li>Commit changes. GitHub Actions пересоберёт сайт за минуту.</li>
      </ol>
      <pre style="margin-top:12px;padding:12px;border-radius:12px;background:var(--surface-2);overflow:auto;font-size:.78rem"><code>cp ~/Downloads/catalog.json data/catalog.json
git add data/catalog.json
git commit -m "Обновление каталога"
git push</code></pre>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Импорт и сброс</h2><p>Загрузите ранее сохранённый JSON или отмените локальные правки.</p></div></div>
      <div class="field-row" style="gap:10px;flex-wrap:wrap">
        <label class="btn btn-ghost btn-sm" style="margin:0">
          ${ui.icon("upload")} Импортировать JSON
          <input type="file" accept="application/json,.json" id="importJson" class="visually-hidden" />
        </label>
        <button class="btn btn-ghost btn-sm" type="button" id="resetDraft">${ui.icon("trash")} Отменить локальные правки</button>
      </div>
      <p class="hint" style="margin-top:8px">«Отменить правки» вернёт данные из <code>data/catalog.json</code> — черновик в браузере будет удалён.</p>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Пароль админки</h2><p>${store.hasCustomPassword() ? "Пароль изменён." : `Сейчас используется пароль по умолчанию: ${esc(store.DEFAULT_PASSWORD)}`}</p></div></div>
      <form id="passwordForm" class="form-grid">
        <div class="field"><label for="p-current">Текущий пароль</label><input id="p-current" name="current" type="password" autocomplete="current-password" required /></div>
        <div class="field"><label for="p-new">Новый пароль</label><input id="p-new" name="next" type="password" autocomplete="new-password" minlength="5" required /></div>
        <div class="field"><label for="p-repeat">Повторите</label><input id="p-repeat" name="repeat" type="password" autocomplete="new-password" required /></div>
        <div class="field span-2"><button class="btn btn-sm" type="submit">${ui.icon("lock")} Сменить пароль</button></div>
      </form>
      <p class="hint" style="margin-top:8px">Пароль хранится только в этом браузере (хэш в localStorage) и не попадает в репозиторий. Это защита от случайных правок, а не полноценная авторизация.</p>
    </div>
  </div>`;
}

function bindPublishTab() {
  $("#downloadJson")?.addEventListener("click", () => {
    try {
      store.downloadJSON("catalog.json");
      ui.toast("Файл скачан — замените data/catalog.json", "ok");
    } catch (error) {
      ui.toast(error.message, "err");
    }
  });

  $("#copyJson")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#jsonOut").value);
      ui.toast("JSON скопирован", "ok");
    } catch {
      $("#jsonOut")?.select();
      ui.toast("Нажмите Ctrl+C, чтобы скопировать", "info");
    }
  });

  $("#importJson")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = store.normalizeCatalog(parsed);
      store.saveDraft(normalized);
      ui.toast("Импортировано в черновик", "ok");
      ctx.refresh();
    } catch (error) {
      ui.toast(`Не удалось импортировать: ${error.message}`, "err");
    }
  });

  $("#resetDraft")?.addEventListener("click", async () => {
    if (!window.confirm("Отменить все локальные правки и вернуться к data/catalog.json?")) return;
    store.discardDraft();
    await store.loadCatalog();
    ui.toast("Локальные правки отменены", "ok");
    ctx.refresh();
  });

  $("#passwordForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    const current = form.elements.current.value;
    const next = form.elements.next.value;
    const repeat = form.elements.repeat.value;
    if (!store.checkPassword(current)) { ui.toast("Текущий пароль неверный", "err"); return; }
    if (next.length < 5) { ui.toast("Новый пароль — минимум 5 символов", "err"); return; }
    if (next !== repeat) { ui.toast("Пароли не совпадают", "err"); return; }
    store.setPassword(next);
    form.reset();
    ui.toast("Пароль изменён", "ok");
  });
}

/* ======================================================================
   Точка входа
   ====================================================================== */
export async function renderAdmin(options) {
  ctx = options;
  draftCatalog = clone(store.getCatalog());

  if (!store.isAdmin()) {
    renderLogin();
    return;
  }

  const [section = "", param = ""] = options.segments || [];
  const tab = section === "" || section === "content" || section === "new" || section === "edit" ? "content" : section;

  if (section === "new" || section === "edit") {
    const isNew = section === "new";
    const existing = isNew ? null : draftCatalog.anime.find((a) => a.id === param);
    if (!isNew && !existing) {
      ui.toast("Аниме не найдено", "err");
      goAdmin("#/admin/content");
      return;
    }
    editorModel = clone(existing || blankAnime());
    ctx.mount.innerHTML = shell("content", editorHTML(editorModel, isNew));
    bindShell();
    bindEditor(editorModel, isNew);
    return;
  }

  let body = "";
  if (tab === "import") body = importTab();
  else if (tab === "genres") body = genresTab();
  else if (tab === "settings") body = settingsTab();
  else if (tab === "publish") body = publishTab();
  else body = contentTab();

  ctx.mount.innerHTML = shell(tab, body);
  bindShell();

  if (tab === "import") bindImportTab();
  else if (tab === "genres") bindGenresTab();
  else if (tab === "settings") bindSettingsTab();
  else if (tab === "publish") bindPublishTab();
  else bindContentTab();
}

