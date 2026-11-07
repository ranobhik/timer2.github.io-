import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "./Icons";

interface Props {
  value: number;
  label: string;
  max: number;
  onUp: () => void;
  onDown: () => void;
  onSet: (v: number) => void;
}

const arrowCls =
  "flex h-[8cqw] w-[13cqw] items-center justify-center rounded-md text-muted transition hover:text-accent active:scale-90";

export function TimeUnit({ value, label, max, onUp, onDown, onSet }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handlers = useRef({ onUp, onDown });
  handlers.current = { onUp, onDown };

  // колёсико мыши (нужен non-passive слушатель)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) handlers.current.onUp();
      else if (e.deltaY > 0) handlers.current.onDown();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (text === "") return;
    const n = Math.min(max, parseInt(text, 10));
    if (!Number.isNaN(n)) onSet(n);
  };

  return (
    <div ref={boxRef} className="flex flex-col items-center">
      <button type="button" className={arrowCls} onClick={onUp} aria-label={`${label} +`}>
        <ChevronUp size="clamp(14px, 5cqw, 22px)" />
      </button>

      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          inputMode="numeric"
          maxLength={2}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 2))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }}
          className="w-[1.3em] border-0 border-b-2 border-accent bg-transparent p-0 text-center font-extrabold leading-none text-ink outline-none"
          style={{ fontSize: "14cqw", height: "14cqw" }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setText(String(value).padStart(2, "0"));
            setEditing(true);
          }}
          title="Нажмите, чтобы ввести значение"
          className="rounded-lg font-extrabold leading-none tabular-nums text-ink transition hover:text-accent"
          style={{ fontSize: "14cqw", height: "14cqw" }}
        >
          {String(value).padStart(2, "0")}
        </button>
      )}

      <div
        className="mt-[1.2cqw] font-semibold tracking-[0.18em] text-muted"
        style={{ fontSize: "clamp(8px, 2.5cqw, 12px)" }}
      >
        {label}
      </div>
      <button type="button" className={arrowCls} onClick={onDown} aria-label={`${label} -`}>
        <ChevronDown size="clamp(14px, 5cqw, 22px)" />
      </button>
    </div>
  );
}
