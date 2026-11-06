import { cn } from "../utils/cn";
import { CheckIcon, MinusIcon, PlusIcon } from "./Icons";

interface Props {
  done: number;
  goal: number;
  auto: boolean;
  onToggleAuto: () => void;
  onGoal: (delta: number) => void;
  onSetDone: (n: number) => void;
  onAdd: () => void;
  onRemove: () => void;
}

export function Sets({ done, goal, auto, onToggleAuto, onGoal, onSetDone, onAdd, onRemove }: Props) {
  const count = Math.max(goal, done);
  const reached = done >= goal && goal > 0;

  return (
    <div className="rounded-2xl border border-line bg-surface2/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-muted">ПОДХОДЫ</span>
          <span
            key={done}
            className={cn(
              "pop rounded-md border px-2 py-0.5 text-[11px] font-bold tabular-nums",
              reached
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                : "border-line bg-surface2 text-ink",
            )}
          >
            {done} / {goal}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleAuto}
            title="Засчитывать подход автоматически, когда таймер дойдёт до нуля"
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold transition",
              auto
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-line bg-surface2 text-muted",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", auto ? "bg-emerald-400" : "bg-muted")} />
            Авто-зачёт
          </button>
          <div className="flex items-center rounded-md border border-line bg-surface2 text-[11px] font-bold text-ink">
            <button
              type="button"
              onClick={() => onGoal(-1)}
              className="px-2 py-1 text-muted transition hover:text-accent"
              aria-label="Уменьшить цель"
            >
              <MinusIcon size={12} />
            </button>
            <span className="px-1 tabular-nums">Цель: {goal}</span>
            <button
              type="button"
              onClick={() => onGoal(1)}
              className="px-2 py-1 text-muted transition hover:text-accent"
              aria-label="Увеличить цель"
            >
              <PlusIcon size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {Array.from({ length: count }, (_, i) => {
          const n = i + 1;
          const isDone = n <= done;
          const isCurrent = n === done + 1;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onSetDone(isDone && n === done ? n - 1 : n)}
              className={cn(
                "flex h-10 min-w-10 flex-1 items-center justify-center rounded-xl border text-sm font-bold transition active:scale-95",
                isDone
                  ? "border-accent bg-accent text-white shadow-[0_6px_16px_-6px_rgba(255,90,31,0.7)]"
                  : isCurrent
                    ? "border-accent/70 bg-surface2 text-ink"
                    : "border-line bg-surface2 text-muted hover:border-accent/40",
              )}
            >
              {isDone ? <CheckIcon size={16} /> : n}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onRemove}
          disabled={done === 0}
          title="Убрать подход"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface2 text-muted transition enabled:hover:text-accent disabled:opacity-40"
        >
          <MinusIcon size={16} />
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="flex h-10 flex-[1.6] items-center justify-center gap-1.5 rounded-xl border border-accent/70 bg-accent/10 px-3 text-sm font-bold text-accent transition hover:bg-accent/20 active:scale-95"
        >
          <PlusIcon size={16} /> Подход
        </button>
      </div>
    </div>
  );
}
