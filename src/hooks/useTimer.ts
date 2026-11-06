import { useCallback, useEffect, useRef, useState } from "react";

export type Status = "idle" | "running" | "paused" | "finished";

export const MAX_MS = (99 * 3600 + 59 * 60 + 59) * 1000;
const KEY = "et66:timer";

interface Saved {
  duration: number;
  remaining: number;
  status: Status;
  endAt: number;
}

function load(defaultMs: number): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (typeof s.duration === "number" && typeof s.remaining === "number") {
        if (s.status === "running") {
          const left = s.endAt - Date.now();
          if (left > 0) return { ...s, remaining: left };
          return { duration: s.duration, remaining: s.duration, status: "idle", endAt: 0 };
        }
        if (s.status === "finished") {
          return { duration: s.duration, remaining: s.duration, status: "idle", endAt: 0 };
        }
        return s;
      }
    }
  } catch {
    /* ignore */
  }
  return { duration: defaultMs, remaining: defaultMs, status: "idle", endAt: 0 };
}

// Воркер не душится браузером в фоновых вкладках, в отличие от setInterval.
const WORKER_CODE = `let id=null;onmessage=function(e){if(e.data==='start'){clearInterval(id);id=setInterval(function(){postMessage(1)},100)}else{clearInterval(id)}}`;

interface Options {
  defaultMs: number;
  cycle: boolean;
  onFinish: () => void;
}

export function useTimer({ defaultMs, cycle, onFinish }: Options) {
  const [init] = useState(() => load(defaultMs));
  const [duration, setDuration] = useState(init.duration);
  const [remaining, setRemaining] = useState(init.remaining);
  const [status, setStatus] = useState<Status>(init.status);

  const endAt = useRef(init.status === "running" ? init.endAt : 0);
  const statusRef = useRef<Status>(init.status);
  const durationRef = useRef(duration);
  const cycleRef = useRef(cycle);
  const onFinishRef = useRef(onFinish);
  durationRef.current = duration;
  cycleRef.current = cycle;
  onFinishRef.current = onFinish;

  const setSt = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // тик
  useEffect(() => {
    if (status !== "running") return;

    const tick = () => {
      if (statusRef.current !== "running") return;
      const left = endAt.current - Date.now();
      if (left > 0) {
        setRemaining(left);
        return;
      }
      onFinishRef.current();
      if (cycleRef.current && durationRef.current > 0) {
        endAt.current = Date.now() + durationRef.current;
        setRemaining(durationRef.current);
      } else {
        setRemaining(0);
        setSt("finished");
      }
    };

    let worker: Worker | null = null;
    let iv: number | undefined;
    try {
      const url = URL.createObjectURL(new Blob([WORKER_CODE], { type: "text/javascript" }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = tick;
      worker.postMessage("start");
    } catch {
      iv = window.setInterval(tick, 100);
    }
    tick();
    return () => {
      worker?.terminate();
      if (iv) window.clearInterval(iv);
    };
  }, [status, setSt]);

  const secs = Math.ceil(remaining / 1000);

  // сохранение (раз в секунду)
  useEffect(() => {
    const data: Saved = { duration, remaining, status, endAt: endAt.current };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, duration, secs]);

  const start = useCallback(() => {
    if (statusRef.current === "running") return;
    const rem = statusRef.current === "finished" ? durationRef.current : remaining;
    if (rem <= 0) return;
    endAt.current = Date.now() + rem;
    setRemaining(rem);
    setSt("running");
  }, [remaining, setSt]);

  const pause = useCallback(() => {
    if (statusRef.current !== "running") return;
    const left = Math.max(0, endAt.current - Date.now());
    setRemaining(left);
    setSt("paused");
  }, [setSt]);

  const toggle = useCallback(() => {
    if (statusRef.current === "running") pause();
    else start();
  }, [pause, start]);

  const reset = useCallback(() => {
    setRemaining(durationRef.current);
    setSt("idle");
  }, [setSt]);

  /** Полная замена времени: останавливает таймер. */
  const setIdle = useCallback(
    (ms: number) => {
      const v = Math.max(0, Math.min(MAX_MS, ms));
      setDuration(v);
      setRemaining(v);
      setSt("idle");
    },
    [setSt],
  );

  /** Правка времени без остановки. */
  const setTotal = useCallback(
    (ms: number) => {
      const v = Math.max(0, Math.min(MAX_MS, ms));
      const st = statusRef.current;
      if (v === 0) {
        setIdle(0);
        return;
      }
      if (st === "running") endAt.current = Date.now() + v;
      if (st === "finished") setSt("idle");
      setRemaining(v);
      setDuration((d) => (st === "idle" || st === "finished" || v > d ? v : d));
    },
    [setIdle, setSt],
  );

  const progress =
    status === "finished" ? 1 : duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0;

  return { status, duration, remaining, secs, progress, start, pause, toggle, reset, setIdle, setTotal };
}
