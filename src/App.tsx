import { useEffect, useRef, useState } from "react";
import { Ring } from "./components/Ring";
import { TimeUnit } from "./components/TimeUnit";
import { Sets } from "./components/Sets";
import {
  BellIcon,
  CheckIcon,
  ExpandIcon,
  MoonIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  ResetIcon,
  ShrinkIcon,
  SunIcon,
  TrashIcon,
  VolumeIcon,
  VolumeOffIcon,
  MinusIcon,
} from "./components/Icons";
import { usePersist } from "./hooks/usePersist";
import { useTimer } from "./hooks/useTimer";
import { SOUNDS, playSound, unlockAudio } from "./lib/sound";
import { setFavicon } from "./lib/favicon";
import { cn } from "./utils/cn";

const APP_NAME = "Таймер ET-66";

const PRESETS = [
  { id: "focus", name: "Фокус", min: 25 },
  { id: "kitchen", name: "Кухня", min: 10 },
  { id: "tea", name: "Чай / Кофе", min: 4 },
  { id: "workout", name: "Тренировка", min: 1 },
  { id: "break", name: "Перерыв", min: 5 },
];

const QUICK = [
  { label: "1 мин", s: 60 },
  { label: "3 мин", s: 180 },
  { label: "5 мин", s: 300 },
  { label: "10 мин", s: 600 },
  { label: "15 мин", s: 900 },
  { label: "25 мин", s: 1500 },
  { label: "45 мин", s: 2700 },
  { label: "1 час", s: 3600 },
];

const ADJUST = [
  { label: "15 сек", d: 15 },
  { label: "30 сек", d: 30 },
  { label: "1 мин", d: 60 },
  { label: "5 мин", d: 300 },
  { label: "30 сек", d: -30 },
];

const COLORS = {
  idle: "#ff5a1f",
  running: "#ff5a1f",
  paused: "#ffb000",
  finished: "#22c55e",
};

const today = () => new Date().toISOString().slice(0, 10);

function fmt(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

const chipCls =
  "rounded-xl border border-line bg-surface2 py-2.5 text-[12px] font-bold text-ink transition hover:border-accent/60 hover:bg-surface2 active:scale-95";

const iconBtn =
  "flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-muted transition hover:text-ink hover:border-accent/50 active:scale-95";

export default function App() {
  const [meta, setMeta] = usePersist("meta", { presetId: "focus" as string | null, label: "Фокус" });
  const [sets, setSets] = usePersist("sets", { done: 0, goal: 5, auto: true });
  const [cycle, setCycle] = usePersist("cycle", false);
  const [muted, setMuted] = usePersist("muted", false);
  const [sound, setSound] = usePersist("sound", "zen");
  const [theme, setTheme] = usePersist<"dark" | "light">("theme", "dark");
  const [daily, setDaily] = usePersist("daily", { date: today(), count: 0 });

  const [editingLabel, setEditingLabel] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const dailyCount = daily.date === today() ? daily.count : 0;

  const timer = useTimer({
    defaultMs: 25 * 60 * 1000,
    cycle,
    onFinish: () => {
      if (!muted) playSound(sound);
      setDaily((d) => ({ date: today(), count: d.date === today() ? d.count + 1 : 1 }));
      if (sets.auto && meta.presetId !== "break") {
        setSets((s) => ({ ...s, done: s.done + 1 }));
      }
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Время вышло!", { body: meta.label || APP_NAME });
        } catch {
          /* ignore */
        }
      }
    },
  });

  const { status, secs, progress } = timer;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const color = COLORS[status];

  // ---------- действия ----------
  const toggle = () => {
    if (status !== "running") {
      unlockAudio();
      if ("Notification" in window && Notification.permission === "default") {
        try {
          void Notification.requestPermission();
        } catch {
          /* ignore */
        }
      }
    }
    timer.toggle();
  };
  const adjust = (d: number) => timer.setTotal((secs + d) * 1000);
  const setUnit = (unit: "h" | "m" | "s", v: number) => {
    const nh = unit === "h" ? v : h;
    const nm = unit === "m" ? v : m;
    const ns = unit === "s" ? v : s;
    timer.setTotal((nh * 3600 + nm * 60 + ns) * 1000);
  };
  const choosePreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setMeta({ presetId: p.id, label: p.name });
    timer.setIdle(p.min * 60 * 1000);
  };
  const quickSet = (sec: number) => {
    if (status === "running" || status === "paused") timer.setTotal(sec * 1000);
    else timer.setIdle(sec * 1000);
  };
  const addSet = () => setSets((x) => ({ ...x, done: x.done + 1 }));
  const removeSet = () => setSets((x) => ({ ...x, done: Math.max(0, x.done - 1) }));

  // ---------- горячие клавиши ----------
  const actions = useRef({ toggle, reset: timer.reset, addSet });
  actions.current = { toggle, reset: timer.reset, addSet };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space") {
        e.preventDefault();
        if (t.tagName === "BUTTON") t.blur();
        actions.current.toggle();
      } else if (k === "r" || k === "к") actions.current.reset();
      else if (k === "m" || k === "ь") setMuted((v) => !v);
      else if (k === "s" || k === "ы") actions.current.addSet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMuted]);

  // ---------- тема ----------
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b0c10" : "#eceef2");
  }, [theme]);

  // ---------- заголовок вкладки ----------
  useEffect(() => {
    const name = meta.label || APP_NAME;
    if (status === "finished") {
      let flip = false;
      document.title = "⏰ Время вышло!";
      const id = window.setInterval(() => {
        flip = !flip;
        document.title = flip ? `🔔 ${name}` : "⏰ Время вышло!";
      }, 1000);
      return () => window.clearInterval(id);
    }
    if (status === "running") document.title = `▶ ${fmt(secs)} · ${name}`;
    else if (status === "paused") document.title = `⏸ ${fmt(secs)} · ${name}`;
    else document.title = secs > 0 ? `${fmt(secs)} · ${APP_NAME}` : APP_NAME;
  }, [status, secs, meta.label]);

  // ---------- иконка вкладки ----------
  useEffect(() => {
    setFavicon({
      progress,
      secs,
      color,
      showText: status === "running" || status === "paused",
    });
    // прогресс меняется каждые 100 мс, а иконке хватит секундной точности
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secs, status, timer.duration]);

  // ---------- полноэкранный режим ----------
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  // ---------- закрытие меню звука ----------
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // ---------- вид ----------
  const badge = {
    idle: { text: "Готов к старту", cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400", dot: "bg-emerald-400" },
    running: { text: "Идёт", cls: "border-accent/50 bg-accent/15 text-accent", dot: "bg-accent" },
    paused: { text: "Пауза", cls: "border-amber-500/50 bg-amber-500/15 text-amber-400", dot: "bg-amber-400" },
    finished: { text: "Время вышло", cls: "border-emerald-500/50 bg-emerald-500/20 text-emerald-400 ring-pulse", dot: "bg-emerald-400" },
  }[status];

  const mainLabel = { idle: "Старт", running: "Пауза", paused: "Продолжить", finished: "Заново" }[status];
  const canStart = status !== "idle" || secs > 0;

  return (
    <div className="flex min-h-screen flex-col items-center px-3 pb-6 pt-4 sm:px-4 sm:pt-6">
      <div className="w-full max-w-[560px]">
        {/* ШАПКА */}
        <header className="mb-4 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDaily({ date: today(), count: 0 })}
              title="Сбросить счётчик завершённых таймеров за сегодня"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface"
            >
              <span className="h-3.5 w-3.5 rounded-full bg-accent shadow-[0_0_14px_rgba(255,90,31,0.9)]" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[15px] font-extrabold tracking-wide">ТАЙМЕР ET-66</h1>
                <span
                  key={dailyCount}
                  title="Завершённых таймеров сегодня"
                  className="pop rounded-md border border-accent/30 bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent"
                >
                  ×{dailyCount}
                </span>
              </div>
              <p className="truncate text-[11px] text-muted">Точный отсчёт времени</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="Мелодия сигнала"
                className={cn(
                  iconBtn,
                  "w-auto gap-2 px-3 text-[12px] font-bold",
                  menuOpen && "border-accent/60 text-ink",
                )}
              >
                <BellIcon size={16} className="text-accent" />
                <span className="hidden sm:inline">{SOUNDS.find((x) => x.id === sound)?.name}</span>
              </button>
              {menuOpen && (
                <div className="fade-in absolute right-0 top-12 z-20 w-52 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-2xl">
                  {SOUNDS.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => {
                        setSound(x.id);
                        playSound(x.id);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition hover:bg-surface2",
                        sound === x.id ? "text-accent" : "text-ink",
                      )}
                    >
                      {x.name}
                      {sound === x.id && <CheckIcon size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMuted(!muted)}
              title="Звук (M)"
              className={cn(iconBtn, muted && "text-accent")}
            >
              {muted ? <VolumeOffIcon size={16} /> : <VolumeIcon size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title="Тема"
              className={iconBtn}
            >
              {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            </button>
            <button type="button" onClick={toggleFullscreen} title="Во весь экран" className={cn(iconBtn, "hidden sm:flex")}>
              {fullscreen ? <ShrinkIcon size={16} /> : <ExpandIcon size={16} />}
            </button>
          </div>
        </header>

        {/* КАРТОЧКА */}
        <main className="card-glow rounded-[28px] border border-line bg-surface p-4 sm:p-6">
          <div className="mx-auto w-full max-w-[420px]">
            <Ring progress={progress} color={color} pulse={status === "finished"}>
              {/* статус */}
              <div className="absolute inset-x-0 flex justify-center" style={{ top: "15.5%" }}>
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 font-bold uppercase tracking-wider",
                    badge.cls,
                  )}
                  style={{ fontSize: "clamp(9px, 2.8cqw, 12px)" }}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", badge.dot)} />
                  {badge.text}
                </span>
              </div>

              {/* название */}
              <div className="absolute inset-x-0 flex justify-center" style={{ top: "23%" }}>
                {editingLabel ? (
                  <input
                    autoFocus
                    value={meta.label}
                    maxLength={20}
                    onChange={(e) => setMeta({ presetId: null, label: e.target.value })}
                    onBlur={() => {
                      setEditingLabel(false);
                      if (!meta.label.trim()) setMeta({ presetId: null, label: "Таймер" });
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                    }}
                    className="w-[34cqw] border-b border-accent bg-transparent text-center font-semibold text-ink outline-none"
                    style={{ fontSize: "clamp(11px, 3.4cqw, 15px)" }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingLabel(true)}
                    title="Переименовать"
                    className="flex items-center gap-1.5 font-semibold text-muted transition hover:text-ink"
                    style={{ fontSize: "clamp(11px, 3.4cqw, 15px)" }}
                  >
                    {meta.label}
                    <PencilIcon size={12} />
                  </button>
                )}
              </div>

              {/* цифры */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-start" style={{ gap: "1.2cqw" }}>
                  <TimeUnit
                    value={h}
                    label="ЧАСЫ"
                    max={99}
                    onUp={() => adjust(3600)}
                    onDown={() => adjust(-3600)}
                    onSet={(v) => setUnit("h", v)}
                  />
                  <Colon />
                  <TimeUnit
                    value={m}
                    label="МИН"
                    max={59}
                    onUp={() => adjust(60)}
                    onDown={() => adjust(-60)}
                    onSet={(v) => setUnit("m", v)}
                  />
                  <Colon />
                  <TimeUnit
                    value={s}
                    label="СЕК"
                    max={59}
                    onUp={() => adjust(1)}
                    onDown={() => adjust(-1)}
                    onSet={(v) => setUnit("s", v)}
                  />
                </div>
              </div>
            </Ring>
          </div>

          {/* пресеты */}
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePreset(p.id)}
                title={`${p.min} мин`}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-[12px] font-bold transition active:scale-95",
                  meta.presetId === p.id
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* подходы */}
          <div className="mt-4">
            <Sets
              done={sets.done}
              goal={sets.goal}
              auto={sets.auto}
              onToggleAuto={() => setSets((x) => ({ ...x, auto: !x.auto }))}
              onGoal={(d) => setSets((x) => ({ ...x, goal: Math.max(1, Math.min(30, x.goal + d)) }))}
              onSetDone={(n) => setSets((x) => ({ ...x, done: n }))}
              onAdd={addSet}
              onRemove={removeSet}
            />
          </div>

          <div className="my-4 h-px bg-line" />

          {/* быстрый выбор */}
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold tracking-[0.14em] text-muted">БЫСТРЫЙ ВЫБОР ВРЕМЕНИ</span>
            <span className="hidden text-[10px] font-semibold text-muted sm:inline">Нажмите на цифры для ввода</span>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {QUICK.map((q) => (
              <button key={q.label} type="button" onClick={() => quickSet(q.s)} className={chipCls}>
                {q.label}
              </button>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ADJUST.map((a) => (
              <button
                key={a.label + a.d}
                type="button"
                onClick={() => adjust(a.d)}
                className="flex items-center justify-center gap-1 rounded-xl border border-line bg-transparent py-2 text-[11px] font-semibold text-muted transition hover:border-accent/60 hover:text-ink active:scale-95"
              >
                {a.d > 0 ? (
                  <PlusIcon size={11} className="text-accent" />
                ) : (
                  <MinusIcon size={11} className="text-muted" />
                )}
                {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => timer.setIdle(0)}
              title="Обнулить"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-[11px] font-semibold text-muted transition hover:border-accent/60 hover:text-ink active:scale-95"
            >
              <TrashIcon size={12} />
              00:00
            </button>
          </div>

          {/* управление */}
          <div className="mt-4 flex items-stretch gap-2.5">
            <button
              type="button"
              onClick={timer.reset}
              title="Сброс (R)"
              className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-surface2 px-4 text-sm font-bold transition hover:border-accent/50 active:scale-95 sm:px-6"
            >
              <ResetIcon size={18} />
              <span className="hidden min-[400px]:inline">Сброс</span>
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={!canStart}
              title="Старт / Пауза (Пробел)"
              className="start-glow flex h-14 flex-1 items-center justify-center gap-2.5 rounded-2xl bg-accent text-base font-extrabold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              {status === "running" ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
              {mainLabel}
            </button>
            <button
              type="button"
              onClick={() => setCycle(!cycle)}
              title="Цикл: перезапускать таймер автоматически"
              className={cn(
                "flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-2xl border text-[9px] font-bold tracking-wider transition active:scale-95",
                cycle
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-line bg-surface2 text-muted hover:text-ink",
              )}
            >
              <RepeatIcon size={18} />
              ЦИКЛ
            </button>
          </div>
        </main>

        {/* подсказки */}
        <footer className="mt-5 hidden flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-muted sm:flex">
          <Hint k="Пробел" t="Старт / Пауза" />
          <Hint k="R" t="Сброс" />
          <Hint k="M" t="Звук" />
          <Hint k="S" t="+1 Подход" />
          <Hint k="Колёсико / Цифры" t="Настройка ЧЧ:ММ:СС" />
        </footer>
        <p className="mt-4 text-center text-[11px] text-muted sm:hidden">
          Время отображается в названии вкладки браузера
        </p>
      </div>
    </div>
  );
}

function Colon() {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ marginTop: "8cqw", height: "14cqw", gap: "2.6cqw", width: "3cqw" }}
    >
      <span className="rounded-full bg-muted/60" style={{ width: "1.8cqw", height: "1.8cqw" }} />
      <span className="rounded-full bg-muted/60" style={{ width: "1.8cqw", height: "1.8cqw" }} />
    </div>
  );
}

function Hint({ k, t }: { k: string; t: string }) {
  return (
    <span className="flex items-center gap-2">
      <kbd className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] font-bold text-ink">{k}</kbd>
      {t}
    </span>
  );
}
