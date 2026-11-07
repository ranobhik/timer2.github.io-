let canvas: HTMLCanvasElement | null = null;

/** Рисует иконку вкладки: кольцо прогресса + оставшееся время. */
export function setFavicon(opts: { progress: number; secs: number; color: string; showText: boolean }) {
  const link = document.getElementById("favicon") as HTMLLinkElement | null;
  if (!link) return;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, 64, 64);

  g.fillStyle = "#16171c";
  g.beginPath();
  g.roundRect(0, 0, 64, 64, 15);
  g.fill();

  const cx = 32;
  const cy = 32;
  const r = 24;
  g.lineWidth = 7;
  g.strokeStyle = "#2b2c35";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();

  const p = Math.max(0, Math.min(1, opts.progress));
  if (p > 0) {
    g.strokeStyle = opts.color;
    g.lineCap = "round";
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    g.stroke();
  }

  if (opts.showText) {
    const { secs } = opts;
    let text: string;
    if (secs >= 3600) text = `${Math.floor(secs / 3600)}ч`;
    else if (secs >= 60) text = String(Math.ceil(secs / 60));
    else text = String(secs);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${text.length > 2 ? 22 : 28}px system-ui, sans-serif`;
    g.fillText(text, cx, cy + 2);
  }

  link.type = "image/png";
  link.href = canvas.toDataURL("image/png");
}
