import { useMemo, type ReactNode } from "react";

interface Props {
  progress: number;
  color: string;
  pulse?: boolean;
  children?: ReactNode;
}

const C = 200;
const R = 156;

export function Ring({ progress, color, pulse, children }: Props) {
  const ticks = useMemo(() => {
    const arr: { x1: number; y1: number; x2: number; y2: number; w: number; o: number }[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const long = i % 15 === 0;
      const mid = i % 5 === 0;
      const r1 = 169;
      const r2 = long ? 188 : mid ? 181 : 175;
      arr.push({
        x1: C + r1 * Math.sin(a),
        y1: C - r1 * Math.cos(a),
        x2: C + r2 * Math.sin(a),
        y2: C - r2 * Math.cos(a),
        w: long ? 2.6 : mid ? 2.2 : 1.6,
        o: long ? 0.9 : mid ? 0.6 : 0.35,
      });
    }
    return arr;
  }, []);

  const ang = progress * Math.PI * 2;
  const dx = C + R * Math.sin(ang);
  const dy = C - R * Math.cos(ang);

  return (
    <div className="relative aspect-square w-full select-none" style={{ containerType: "inline-size" }}>
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full overflow-visible">
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="var(--muted)"
            strokeWidth={t.w}
            strokeLinecap="round"
            opacity={t.o}
          />
        ))}
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line)" strokeWidth={9} opacity={0.7} />
        {progress > 0 && (
          <circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={9}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${Math.min(progress, 0.9999) * 100} 200`}
            transform={`rotate(-90 ${C} ${C})`}
            className={pulse ? "ring-pulse" : undefined}
            style={{ filter: `drop-shadow(0 0 7px ${color}88)`, transition: "stroke 0.3s" }}
          />
        )}
        <circle
          cx={dx}
          cy={dy}
          r={6.5}
          fill="var(--surface)"
          stroke={color}
          strokeWidth={3.5}
          className={pulse ? "ring-pulse" : undefined}
        />
      </svg>
      {children}
    </div>
  );
}
