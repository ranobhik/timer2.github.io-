import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "et66:";

export function usePersist<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* ignore */
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);

  return [value, setValue];
}
