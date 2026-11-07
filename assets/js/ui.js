/* Компоненты интерфейса: карточки, постеры, плеер, тосты. */

import { getCatalog, isFavorite } from "./store.js";
import { modernizeKodikUrl } from "./sources.js";
import { attr, esc, hueFrom, initials, pluralEpisodes, safeUrl, statusLabel } from "./utils.js";

export const icon = (name, cls = "") =>
  `<svg aria-hidden="true"${cls ? ` class="${esc(cls)}"` : ""}><use href="#i-${esc(name)}" /></svg>`;

/* ---------- Постер ---------- */
export function posterInner(anime, label = "Рабочая партия") {
  const src = safeUrl(anime.poster);
  const hue = hueFrom(anime.title || anime.id);
  const fallback = `<div class="poster-fallback" style="--h:${hue}" aria-hidden="true">
      <span>${esc(initials(anime.title))}</span><small>${esc(label)}</small>
    </div>`;
  if (!src) return fallback;
  const onerror = "if(!this.dataset.png){this.dataset.png='1';this.src=this.src.replace(/\\.jpg(\\?|$)/,'.png');}else{this.remove();}";
  return `${fallback}<img src="${attr(src)}" alt="Постер «${attr(anime.title)}»" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false" style="position:absolute;inset:0;z-index:1" onerror="${onerror}" />`;
}

/* ---------- Карточка аниме ---------- */
export function cardHTML(anime, opts = {}) {
  const fav = isFavorite(anime.id);
  const total = anime.episodes.length;
  const progress = Number(opts.progress) || 0;
  const genre = anime.genres[0] || "";
  const href = opts.href || `#/anime/${anime.id}`;
  return `<article class="card" data-anime-card="${attr(anime.id)}">
    <div class="card-poster" style="--h:${hueFrom(anime.title)}">
      ${posterInner(anime)}
      <a class="card-link" draggable="false" href="${attr(href)}" aria-label="${attr(opts.continue ? `Продолжить просмотр: ${anime.title}` : `${anime.title} — открыть страницу`)}"></a>
      ${total ? `<span class="card-badge">${icon("tv")} ${total}</span>` : ""}
      ${anime.rating ? `<span class="card-badge rating">${icon("star")} ${anime.rating.toFixed(1)}</span>` : ""}
      <button class="card-fav${fav ? " is-on" : ""}" type="button" data-fav="${attr(anime.id)}"
        aria-label="${fav ? "Убрать из избранного" : "Добавить в избранное"}" aria-pressed="${fav}" title="${fav ? "Убрать из избранного" : "В избранное"}">${icon("heart")}</button>
      ${progress > 0 ? `<div class="card-progress"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ""}
    </div>
    <div class="card-body">
      <a class="card-link" draggable="false" href="${attr(href)}">
        <h3 class="card-title">${esc(anime.title)}</h3>
        <p class="card-sub">
          <span>${esc(anime.year)}</span>
          ${genre ? `<span class="dot">${esc(genre)}</span>` : ""}
          <span class="dot">${esc(statusLabel(anime.status))}</span>
        </p>
      </a>
    </div>
  </article>`;
}

/* ---------- Заглушка ---------- */
export function emptyHTML({ iconName = "info", title = "Пусто", text = "", action = "" } = {}) {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName)}</div>
    <h3>${esc(title)}</h3>
    ${text ? `<p>${esc(text)}</p>` : ""}
    ${action}
  </div>`;
}

/* ---------- Тосты ---------- */
export function toast(message, type = "info") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  const iconName = type === "ok" ? "check" : type === "err" ? "x" : "info";
  node.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
  host.append(node);
  setTimeout(() => {
    node.classList.add("is-out");
    setTimeout(() => node.remove(), 280);
  }, 3200);
}

/* ---------- HTML с исполнением скриптов (для embed-кодов) ---------- */
export function injectHTML(container, html) {
  container.innerHTML = html;
  container.querySelectorAll("script").forEach((old) => {
    const script = document.createElement("script");
    Array.from(old.attributes).forEach((a) => script.setAttribute(a.name, a.value));
    script.textContent = old.textContent;
    old.replaceWith(script);
  });
}

/* ---------- HLS (для .m3u8) ---------- */
let hlsPromise = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsPromise) {
    hlsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
      script.onload = () => resolve(window.Hls);
      script.onerror = () => reject(new Error("hls.js не загрузился"));
      document.head.append(script);
    });
  }
  return hlsPromise;
}

/* CVH (CDNVideoHub) отдаёт ссылку на поток только по запросу и живёт она около суток,
   поэтому серия CVH хранит идентификатор видео, а ссылка запрашивается при показе. */
const CVH_API = "https://plapi.cdnvideohub.com/api/v1/player/sv";

function cvhProxy() {
  try {
    const settings = (getCatalog?.()?.settings) || {};
    return String(settings.corsProxy || "").trim();
  } catch {
    return "";
  }
}

/* Качества, которые отдаёт CVH (Odnoklassniki CDN): от лучшего к худшему */
const CVH_QUALITIES = [
  ["mpeg4kUrl", "2160p"],
  ["mpegQhdUrl", "1440p"],
  ["mpegFullHdUrl", "1080p"],
  ["mpegHighUrl", "720p"],
  ["mpegMediumUrl", "480p"],
  ["mpegLowUrl", "360p"],
];

async function cvhFetch(vkId) {
  const url = `${CVH_API}/video/${encodeURIComponent(vkId)}`;
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    const proxy = cvhProxy();
    if (!proxy) throw error;
    response = await fetch(`${proxy}${encodeURIComponent(url)}`, { cache: "no-store" });
  }
  if (!response.ok) throw new Error(`CVH ответил ${response.status}`);
  return response.json();
}

/** Все доступные качества по убыванию + HLS как «авто». */
async function cvhVariants(vkId) {
  const data = await cvhFetch(vkId);
  const list = data?.sources || {};
  const variants = CVH_QUALITIES
    .map(([key, label]) => ({ label, url: String(list[key] || "") }))
    .filter((item) => item.url);
  if (list.hlsUrl) variants.push({ label: "Авто", url: String(list.hlsUrl), hls: true });
  return variants;
}

async function cvhStream(vkId) {
  const variants = await cvhVariants(vkId);
  const best = variants.find((item) => !item.hls) || variants[0];
  return best ? best.url : "";
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Ряд кнопок скорости воспроизведения. */
function speedRow(video) {
  const row = document.createElement("div");
  row.className = "cvh-quality cvh-speed";
  const label = document.createElement("span");
  label.className = "cvh-quality-label";
  label.textContent = "Скорость";
  row.append(label);
  const buttons = [];
  SPEEDS.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost btn-sm";
    button.textContent = value === 1 ? "1×" : `${String(value).replace(".", ",")}×`;
    if (value === 1) button.classList.add("is-active");
    button.addEventListener("click", () => {
      video.playbackRate = value;
      buttons.forEach((item) => item.classList.toggle("is-active", item === button));
    });
    buttons.push(button);
    row.append(button);
  });
  return row;
}

/** Плеер CVH: своё видео + выбор качества, как в плеере Shikimori. */
function mountCvh(mount, variants, player, ctx = {}) {
  const { anime, onProgress } = ctx;
  const start = variants.find((item) => !item.hls) || variants[0];
  mount.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "player-inner cvh-player";
  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  const poster = safeUrl(anime?.banner) || safeUrl(anime?.poster);
  if (poster) video.poster = poster;
  shell.append(video);

  const bar = document.createElement("div");
  bar.className = "cvh-quality";
  const label = document.createElement("span");
  label.className = "cvh-quality-label";
  label.textContent = "Качество";
  bar.append(label);

  const apply = (variant, button) => {
    const time = video.currentTime;
    const playing = !video.paused;
    if (variant.hls) {
      loadHls()
        .then((Hls) => {
          if (mount._hls) { mount._hls.destroy(); mount._hls = null; }
          if (Hls && Hls.isSupported() && video.canPlayType("application/vnd.apple.mpegurl") === "") {
            const hls = new Hls({ enableWorker: true });
            hls.loadSource(variant.url);
            hls.attachMedia(video);
            mount._hls = hls;
          } else {
            video.src = variant.url;
          }
          if (time) video.currentTime = time;
          if (playing) video.play().catch(() => {});
        })
        .catch(() => { video.src = variant.url; });
    } else {
      if (mount._hls) { mount._hls.destroy(); mount._hls = null; }
      video.src = variant.url;
      if (time) video.currentTime = time;
      if (playing) video.play().catch(() => {});
    }
    bar.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
  };

  variants.forEach((variant) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost btn-sm";
    button.textContent = variant.label;
    button.addEventListener("click", () => apply(variant, button));
    bar.append(button);
  });
  shell.append(bar);
  shell.append(speedRow(video));
  mount.append(shell);

  apply(start, bar.querySelector("button"));
  if (typeof onProgress === "function") {
    video.addEventListener("timeupdate", () => {
      if (video.duration) onProgress(video.currentTime / video.duration);
    });
  }
}

export function playerPlaceholder(title, text) {
  return `<div class="player-placeholder">
    ${icon("play")}
    <b>${esc(title)}</b>
    <small>${esc(text)}</small>
  </div>`;
}

/**
 * Монтирует плеер в контейнер .player-frame.
 * @param {HTMLElement} mount
 * @param {{type:string,url:string,code:string,name:string}} player
 * @param {{anime?:object, onProgress?:(ratio:number)=>void}} ctx
 */
export function mountPlayer(mount, player, ctx = {}) {
  const { anime, onProgress } = ctx;
  /* перерисовка страницы не должна перезапускать уже показанный плеер */
  const key = [player?.type, player?.url, player?.code, anime?.id].join("|");
  if (mount.dataset.playerKey === key && mount.childElementCount) return;
  mount.dataset.playerKey = key;
  if (mount._hls) { try { mount._hls.destroy(); } catch { /* уже уничтожен */ } mount._hls = null; }
  mount.innerHTML = "";
  const note = "Добавьте ссылку или код вставки в админ-панели: Контент → Редактировать → Эпизоды → Плееры.";

  if (!player || player.type === "demo" || (!player.url && !player.code)) {
    mount.innerHTML = playerPlaceholder(
      "Плеер ещё не подключён",
      player?.code ? "Код вставки пуст." : note,
    );
    return;
  }

  if (player.type === "iframe" || (player.type === "html" && /^\s*https?:\/\//i.test(player.url) && !player.code)) {
    const src = safeUrl(modernizeKodikUrl(player.url));
    if (!src) {
      mount.innerHTML = playerPlaceholder("Некорректная ссылка", "Разрешены только http(s) и относительные адреса.");
      return;
    }
    const frame = document.createElement("iframe");
    frame.src = src;
    frame.title = `${player.name} — ${anime?.title || "видео"}`;
    frame.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("loading", "lazy");
    mount.append(frame);
    return;
  }

  if (player.type === "html") {
    const html = modernizeKodikUrl(player.code || (player.url ? `<iframe src="${attr(player.url)}" allowfullscreen allow="autoplay; fullscreen"></iframe>` : ""));
    if (!html.trim()) {
      mount.innerHTML = playerPlaceholder("Пустой код вставки", note);
      return;
    }
    const holder = document.createElement("div");
    holder.className = "player-inner";
    mount.append(holder);
    injectHTML(holder, html);
    return;
  }

  if (player.type === "cvh") {
    const vkId = String(player.url || "").replace(/^cvh:/, "").trim();
    if (!/^\d+$/.test(vkId)) {
      mount.innerHTML = playerPlaceholder("Плеер CVH не настроен", "В админке нажмите «Плееры из CVH» или вставьте ссылку вручную.");
      return;
    }
    mount.innerHTML = playerPlaceholder("Загружаю плеер CVH…", "Ссылка на видео запрашивается при каждом показе.");
    cvhVariants(vkId)
      .then((variants) => {
        if (!variants.length) throw new Error("CVH не вернул ссылку на видео");
        mountCvh(mount, variants, player, ctx);
      })
      .catch((error) => {
        mount.innerHTML = playerPlaceholder(
          "CVH не ответил",
          `${error?.message || "Ошибка запроса"} — выберите другой плеер или обновите страницу.`,
        );
      });
    return;
  }

  if (player.type === "video") {
    const src = safeUrl(player.url);
    if (!src) {
      mount.innerHTML = playerPlaceholder("Некорректная ссылка на видео", "Укажите прямую ссылку на .mp4 или .m3u8.");
      return;
    }
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    const poster = safeUrl(anime?.banner) || safeUrl(anime?.poster);
    if (poster) video.poster = poster;

    if (/\.m3u8(\?|$)/i.test(src)) {
      loadHls()
        .then((Hls) => {
          if (Hls && Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true });
            hls.loadSource(src);
            hls.attachMedia(video);
            mount._hls = hls;
          } else {
            video.src = src;
          }
        })
        .catch(() => { video.src = src; });
    } else {
      video.src = src;
    }

    if (typeof onProgress === "function") {
      let last = 0;
      video.addEventListener("timeupdate", () => {
        if (!video.duration || Number.isNaN(video.duration)) return;
        const ratio = video.currentTime / video.duration;
        const now = Date.now();
        if (now - last > 4000 || ratio >= 0.999) {
          last = now;
          onProgress(Math.min(1, Math.max(0, ratio)));
        }
      });
    }
    const shell = document.createElement("div");
    shell.className = "player-inner cvh-player";
    shell.append(video);
    shell.append(speedRow(video));
    mount.append(shell);
    return;
  }

  mount.innerHTML = playerPlaceholder("Неизвестный тип плеера", note);
}

export function episodesLabel(count) {
  return pluralEpisodes(count);
}

/* ---------- Мелкие форматтеры ---------- */
export function ratingHTML(rating) {
  if (!rating) return "";
  return `<span class="chip chip-accent">${icon("star")} ${rating.toFixed(1)}</span>`;
}

export function metaChips(anime) {
  const chips = [];
  chips.push(`<span class="chip">${esc(anime.year)}</span>`);
  if (anime.ageRating) chips.push(`<span class="chip">${esc(anime.ageRating)}</span>`);
  if (anime.status === "ongoing") chips.push(`<span class="chip chip-dot chip-live">Онгоинг</span>`);
  else chips.push(`<span class="chip">${esc(statusLabel(anime.status))}</span>`);
  if (anime.episodes.length) chips.push(`<span class="chip">${icon("tv")} ${pluralEpisodes(anime.episodes.length)}</span>`);
  if (anime.rating) chips.push(`<span class="chip chip-accent">${icon("star")} ${anime.rating.toFixed(1)}</span>`);
  return chips.join("");
}
