/**
 * RampStrip — the family Arena strip. ONE FILE, copied byte-for-byte into every
 * app (canonical copy: C:\Dev\_tools\ramp-strip). Do not edit it inside an app;
 * change the canonical copy and run _tools/ramp-strip/sync.mjs.
 *
 *   [ Solo ][ Battle ]   [ part ▾ ]   [ Slow ][ Fast ]
 *   ●━━━━━━━━━━━━━━━━━━━━━━━━│limit━━━━━│breaks━━━━━━   ← fill coloured by level
 *   [ − ]  1.25× · 31 V  [ + ]   [ Run | Pause | Resume ]  [ ↺ ]
 *
 * Behaviour every app shares:
 *  - Run starts climbing at once, from wherever the slider is.
 *  - The slider and − / + move the load any time; a climb carries on from there.
 *  - − / + held down repeat.
 *  - Pause parks the load where it is and lets the heat build; Resume climbs on.
 *  - The fill and the readout turn colour with the part's F.U.S.E. level.
 *  - Two ticks on the track: where the part reaches its rating, and where it breaks.
 *  - At the break the phone buzzes and the readout says where it broke.
 *  - 🎲 lives inside the picker, so the row stays as it was: "🎲 Random part"
 *    heads the Solo list; Battle's list has 🎲 Shuffle (same number of parts).
 *  - Battle picks 2 to 5 parts from a short list that opens over the scene and
 *    closes itself on Run or a tap elsewhere. Every part gets its break tick;
 *    the first to break ends the run.
 *
 * Presentational only: every app keeps its own engine and passes plain values in.
 * Positions are 0..1 along the track; the app maps them to its own units.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import "./ramp-strip.css";

export type RampLevel = "safe" | "stressed" | "warning" | "critical" | "failed";
export type RampState = "idle" | "running" | "paused" | "failed" | "done";
export type RampRate = "slow" | "fast";
export type RampTick = { at: number; kind: "limit" | "break"; label: string };
export type RampOption = { id: string; label: string; disabled?: boolean };

export type RampStripProps = {
  modes: RampOption[];
  mode: string;
  onMode: (id: string) => void;
  /** The part being broken. Omit to hide the picker. */
  parts?: RampOption[];
  part?: string;
  onPart?: (id: string) => void;
  /** Battle: the line-up. Given, the picker becomes a multi-pick of 2..maxPicked. */
  picked?: string[];
  onPicked?: (ids: string[]) => void;
  maxPicked?: number;
  /** 🎲, inside the picker. randomPart / randomSet below do the picking. */
  onShuffle?: () => void;
  rate: RampRate;
  onRate: (rate: RampRate) => void;
  /** Load position along the track, 0..1. */
  value: number;
  onValue: (value: number) => void;
  /** One tap of − / +, as a fraction of the track. */
  step?: number;
  /** The number the incrementer moves, already formatted ("1.25× · 31 V"). */
  readout: string;
  level: RampLevel;
  ticks?: RampTick[];
  state: RampState;
  onRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  /** After a break: "Broke at 2.35×". Shown in place of the readout. */
  result?: string | null;
  /** Optional way to the app's own dashboard; a ⋯ at the end of the top row. */
  onMore?: () => void;
  /** Reports the strip's measured height so the scene can sit clear of it. */
  onHeight?: (px: number) => void;
  className?: string;
  /** Extra attributes for the root, e.g. { "data-occlude": "bottom" } for a camera that frames around it. */
  attrs?: Record<string, string>;
};

/** Most parts in one Battle. */
export const RAMP_BATTLE_MAX = 5;

const usable = (parts: RampOption[]) => parts.filter((p) => !p.disabled);
/** The picker's own 🎲 entry. */
const RANDOM = "__rs_random__";

/** A different part at random (the same one only if there is no other). */
export function randomPart(parts: RampOption[], current?: string): string | undefined {
  const pool = usable(parts);
  const others = pool.filter((p) => p.id !== current);
  const from = others.length ? others : pool;
  return from[Math.floor(Math.random() * from.length)]?.id;
}

/** A random line-up of n different parts. */
export function randomSet(parts: RampOption[], n: number): string[] {
  const pool = usable(parts).map((p) => p.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(1, n));
}

/** A Battle's starting line-up: the current part and the next ones along. */
export function defaultSet(parts: RampOption[], current?: string, n = 3): string[] {
  const pool = usable(parts).map((p) => p.id);
  const at = Math.max(0, pool.indexOf(current ?? ""));
  return [...pool.slice(at), ...pool.slice(0, at)].slice(0, n);
}

/** One part in a Battle: where on the track (0..1) it breaks, or null if it holds. */
export type RampContender = { id: string; label: string; breaksAt: number | null };

/** The first word of a part's name, for a tick that has to share the track. */
export const shortLabel = (label: string) => label.split(/[\s·,(]+/).filter(Boolean)[0] ?? label;

/** Battle: one break tick per part, in its short name. */
export function battleTicks(contenders: RampContender[]): RampTick[] {
  return contenders
    .filter((c) => c.breaksAt != null && c.breaksAt > 0 && c.breaksAt <= 1)
    .map((c) => ({ at: c.breaksAt as number, kind: "break" as const, label: shortLabel(c.label) }));
}

/** Battle: who goes first, and the order the rest follow in. Parts that hold come last. */
export function breakOrder(contenders: RampContender[]): RampContender[] {
  return [...contenders].sort((a, b) => (a.breaksAt ?? Infinity) - (b.breaksAt ?? Infinity));
}

/** Where a tick's label leans: inward near either end, centred elsewhere. */
const leanOf = (at: number) => (at > 0.85 ? "end" : at < 0.15 ? "start" : "mid");

/**
 * Which tick labels to print: breaks first, then limits, skipping any that
 * would print over one already placed. Five parts' ticks can sit close.
 * Widths are estimated as a share of a phone-width track (9px capitals).
 */
function labelled(ticks: RampTick[]): Set<number> {
  const keep = new Set<number>();
  const placed: [number, number][] = [];
  const span = (t: RampTick): [number, number] => {
    const w = t.label.length * 0.022 + 0.01;
    const lean = leanOf(t.at);
    return lean === "end" ? [t.at - w, t.at] : lean === "start" ? [t.at, t.at + w] : [t.at - w / 2, t.at + w / 2];
  };
  for (const kind of ["break", "limit"] as const) {
    ticks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.kind === kind)
      .sort((a, b) => a.t.at - b.t.at)
      .forEach(({ t, i }) => {
        const [a, b] = span(t);
        if (placed.every(([c, d]) => b + 0.015 < c || a > d + 0.015)) {
          keep.add(i);
          placed.push([a, b]);
        }
      });
  }
  return keep;
}

/** Battle's picker: a summary button, and a short list that opens above the strip. */
function MultiPick({
  parts, picked, onPicked, onShuffle, max, disabled,
}: {
  parts: RampOption[];
  picked: string[];
  onPicked: (ids: string[]) => void;
  onShuffle?: () => void;
  max: number;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const isOpen = open && !disabled;
  useEffect(() => {
    if (!isOpen) return;
    const away = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes the list and nothing else: apps close the whole Arena on it.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [isOpen]);
  // The count leads: a narrow strip cuts the end of the button off, never the number.
  const summary = `${picked.length} parts`;
  const toggle = (id: string) => {
    if (picked.includes(id)) {
      if (picked.length > 2) onPicked(picked.filter((x) => x !== id));
    } else if (picked.length < max) {
      onPicked([...picked, id]);
    }
  };
  return (
    <div className="rs-multi" ref={boxRef}>
      <button
        type="button"
        className="rs-part"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Parts in the battle: ${picked.length}`}
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
      </button>
      {isOpen ? (
        <div className="rs-pick" role="listbox" aria-multiselectable="true" aria-label="Parts in the battle">
          <div className="rs-pick-head">
            <span>{`${picked.length} of ${max}`}</span>
            {onShuffle ? (
              <button type="button" className="rs-chip rs-shuffle" onClick={onShuffle}>
                🎲 Shuffle
              </button>
            ) : null}
            <button type="button" className="rs-chip" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
          {parts.map((p) => {
            const on = picked.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={on}
                className={`rs-pick-item${on ? " is-on" : ""}`}
                disabled={p.disabled || (!on && picked.length >= max)}
                onClick={() => toggle(p.id)}
              >
                <i aria-hidden>{on ? "✓" : ""}</i>
                {p.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const HOLD_MS = 380;
const REPEAT_MS = 90;
const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

function Nudge({ dir, onStep, disabled }: { dir: 1 | -1; onStep: (dir: 1 | -1) => void; disabled: boolean }) {
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rep = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (wait.current) clearTimeout(wait.current);
    if (rep.current) clearInterval(rep.current);
    wait.current = null;
    rep.current = null;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  return (
    <button
      type="button"
      className="rs-nudge"
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        stop();
        onStep(dir);
        wait.current = setTimeout(() => {
          rep.current = setInterval(() => onStep(dir), REPEAT_MS);
        }, HOLD_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      // Keyboard: Enter / Space arrive as a click with no pointer behind them.
      onClick={(e) => e.detail === 0 && !disabled && onStep(dir)}
      aria-label={dir > 0 ? "Load up" : "Load down"}
    >
      {dir > 0 ? "+" : "−"}
    </button>
  );
}

export function RampStrip(props: RampStripProps) {
  const {
    modes, mode, onMode, parts, part, onPart, picked, onPicked, maxPicked = RAMP_BATTLE_MAX,
    onShuffle, rate, onRate, value, onValue,
    step = 0.02, readout, level, ticks = [], state, onRun, onPause, onResume,
    onReset, result, onMore, onHeight, className, attrs,
  } = props;
  const rootRef = useRef<HTMLElement | null>(null);
  // Read fresh on every repeat: a held button steps faster than the strip repaints.
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeight) return;
    const report = () => onHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  // The break is felt as well as seen.
  const prevState = useRef(state);
  useEffect(() => {
    if (state === "failed" && prevState.current !== "failed") {
      try {
        navigator.vibrate?.([60, 40, 140]);
      } catch {
        /* no vibration motor, or blocked: the card still says it */
      }
    }
    prevState.current = state;
  }, [state]);

  const ended = state === "failed" || state === "done";
  const v = clamp01(value);
  const shown = labelled(ticks);
  const nudge = (dir: 1 | -1) => onValue(clamp01(valueRef.current + dir * step));
  const action =
    state === "running"
      ? { label: "Pause", go: onPause }
      : state === "paused"
        ? { label: "Resume", go: onResume }
        : { label: ended ? "Run again" : "Run", go: onRun };

  return (
    <section
      ref={rootRef}
      className={`rs rs--${level} rs-state--${state}${className ? ` ${className}` : ""}`}
      style={{ "--rs-v": v } as CSSProperties}
      aria-label="The Ramp"
      {...attrs}
    >
      <div className="rs-top">
        <div className="rs-group" role="group" aria-label="Arena mode">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`rs-chip${mode === m.id ? " is-on" : ""}`}
              aria-pressed={mode === m.id}
              disabled={m.disabled}
              onClick={() => mode !== m.id && onMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {parts && parts.length > 0 && picked && onPicked ? (
          <MultiPick
            parts={parts}
            picked={picked}
            onPicked={onPicked}
            onShuffle={onShuffle}
            max={maxPicked}
            disabled={state === "running"}
          />
        ) : parts && parts.length > 0 && onPart ? (
          <select
            className="rs-part"
            value={part}
            disabled={state === "running"}
            onChange={(e) => (e.target.value === RANDOM ? onShuffle?.() : onPart(e.target.value))}
            aria-label="Part to break"
          >
            {onShuffle && parts.length > 1 ? <option value={RANDOM}>🎲 Random part</option> : null}
            {parts.map((p) => (
              <option key={p.id} value={p.id} disabled={p.disabled}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="rs-spacer" />
        )}
        <div className="rs-group" role="group" aria-label="Ramp speed">
          {(["slow", "fast"] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`rs-chip${rate === r ? " is-on" : ""}`}
              aria-pressed={rate === r}
              onClick={() => onRate(r)}
            >
              {r === "slow" ? "Slow" : "Fast"}
            </button>
          ))}
        </div>
        {onMore ? (
          <button type="button" className="rs-chip rs-more" onClick={onMore} aria-label="Arena dashboard">
            ⋯
          </button>
        ) : null}
      </div>

      <div className="rs-track">
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={v}
          disabled={ended}
          onChange={(e) => onValue(Number(e.target.value))}
          aria-label="Ramp the load past the part's limit"
        />
        {ticks.map((t, i) => (
          <span
            key={`${t.kind}-${t.at}-${i}`}
            className={`rs-tick rs-tick--${t.kind}${leanOf(t.at) === "mid" ? "" : ` rs-tick--${leanOf(t.at)}`}`}
            style={{ "--rs-at": clamp01(t.at) } as CSSProperties}
            title={t.label}
            aria-hidden
          >
            {/* Ticks this close would print over each other: the first break keeps its word. */}
            {shown.has(i) ? <i>{t.label}</i> : null}
          </span>
        ))}
      </div>

      <div className="rs-bottom">
        <div className="rs-step" role="group" aria-label="Nudge the load">
          <Nudge dir={-1} onStep={nudge} disabled={ended || v <= 0} />
          <b className="rs-readout" aria-live="polite">
            {ended && result ? result : readout}
          </b>
          <Nudge dir={1} onStep={nudge} disabled={ended || v >= 1} />
        </div>
        <button type="button" className="rs-run" onClick={action.go}>
          {action.label}
        </button>
        {state !== "idle" ? (
          <button type="button" className="rs-reset" onClick={onReset} aria-label="Reset" title="Reset">
            ↺
          </button>
        ) : null}
      </div>
    </section>
  );
}

export default RampStrip;
