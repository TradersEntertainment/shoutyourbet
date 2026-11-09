import type { Instrument } from "@syb/shared";

export function InstrumentBadge({ inst, size = 28 }: { inst: Instrument; size?: number }) {
  const label = inst.id.slice(0, 4);
  const scale = label.length >= 4 ? 0.27 : label.length === 3 ? 0.31 : 0.38;
  return (
    <span
      className="badge-coin"
      style={{ width: size, height: size, background: inst.color, fontSize: size * scale }}
      aria-hidden
    >
      {label}
    </span>
  );
}
