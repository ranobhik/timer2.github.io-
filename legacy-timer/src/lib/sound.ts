export interface SoundDef {
  id: string;
  name: string;
}

export const SOUNDS: SoundDef[] = [
  { id: "zen", name: "Аккорд Дзен" },
  { id: "bell", name: "Колокольчик" },
  { id: "beep", name: "Бип-бип" },
  { id: "arp", name: "Арпеджио" },
  { id: "gong", name: "Гонг" },
];

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Вызывать из обработчика клика, чтобы браузер разрешил звук позже. */
export function unlockAudio() {
  getCtx();
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  attack = 0.01,
) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playSound(id: string) {
  const c = getCtx();
  if (!c) return;
  switch (id) {
    case "bell":
      for (let i = 0; i < 3; i++) {
        const s = i * 0.9;
        tone(c, 880, s, 1.8, "sine", 0.35);
        tone(c, 880 * 2.76, s, 1.0, "sine", 0.12);
        tone(c, 880 * 5.4, s, 0.5, "sine", 0.05);
      }
      break;
    case "beep":
      for (let i = 0; i < 4; i++) tone(c, 1000, i * 0.22, 0.14, "square", 0.12, 0.005);
      break;
    case "arp":
      [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) =>
        tone(c, f, i * 0.14, 0.9, "triangle", 0.28),
      );
      break;
    case "gong":
      tone(c, 110, 0, 4, "sine", 0.5, 0.02);
      tone(c, 164, 0, 3.4, "sine", 0.25, 0.02);
      tone(c, 277, 0, 2.6, "sine", 0.12, 0.02);
      tone(c, 450, 0, 1.6, "sine", 0.06, 0.02);
      break;
    case "zen":
    default:
      [261.63, 329.63, 392, 523.25, 587.33].forEach((f, i) => {
        tone(c, f, i * 0.05, 3.2, "sine", 0.2, 0.04);
        tone(c, f, 1.6 + i * 0.05, 2.6, "sine", 0.14, 0.04);
      });
      break;
  }
}
