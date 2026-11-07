/* Компоненты интерфейса: карточки, постеры, плеер, тосты. */

import { isFavorite } from "./store.js";
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
  return `${fallback}<img src="${attr(src)}" alt="Постер «${attr(anime.title)}»" loading="lazy" decoding="async" style="position:absolute;inset:0;z-index:1" onerror="this.remove()" />`;
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
      <a class="card-link" href="${attr(href)}" aria-label="${attr(opts.continue ? `Продолжить просмотр: ${anime.title}` : `${anime.title} — открыть страницу`)}"></a>
      ${total ? `<span class="card-badge">${icon("tv")} ${total}</span>` : ""}
      ${anime.rating ? `<span class="card-badge rating">${icon("star")} ${anime.rating.toFixed(1)}</span>` : ""}
      <button class="card-fav${fav ? " is-on" : ""}" type="button" data-fav="${attr(anime.id)}"
        aria-label="${fav ? "Убрать из избранного" : "Добавить в избранное"}" aria-pressed="${fav}" title="${fav ? "Убрать из избранного" : "В избранное"}">${icon("heart")}</button>
      ${progress > 0 ? `<div class="card-progress"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ""}
    </div>
    <div class="card-body">
      <a class="card-link" href="${attr(href)}">
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
  mount.innerHTML = "";
  const { anime, onProgress } = ctx;
  const note = "Добавьте ссылку или код вставки в админ-панели: Контент → Редактировать → Эпизоды → Плееры.";

  if (!player || player.type === "demo" || (!player.url && !player.code)) {
    mount.innerHTML = playerPlaceholder(
      "Плеер ещё не подключён",
      player?.code ? "Код вставки пуст." : note,
    );
    return;
  }

  if (player.type === "iframe" || (player.type === "html" && /^\s*https?:\/\//i.test(player.url) && !player.code)) {
    const src = safeUrl(player.url);
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
    const html = player.code || (player.url ? `<iframe src="${attr(player.url)}" allowfullscreen allow="autoplay; fullscreen"></iframe>` : "");
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
    mount.append(video);
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
