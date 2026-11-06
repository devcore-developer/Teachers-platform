"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * FitText — single-line label that ALWAYS fits its container.
 *
 * The sidebar wordmark and the school identity card must show the full
 * school name on ONE line no matter how long the name is. This component
 * measures the natural width of the text against the width it actually
 * has and shrinks the font proportionally, down to a readable floor.
 * Truncation with a tooltip is only the LAST resort, for pathological
 * names that would not fit even at the floor size.
 *
 * How it works (dependency-free, ~60 lines):
 *  1. A hidden probe span renders the SAME text at a fixed reference
 *     size (MEASURE_PX) with identical font classes, so weight and
 *     tracking match the visible label exactly.
 *  2. required size = availableWidth / (probeWidth / MEASURE_PX),
 *     clamped to [minPx, maxPx].
 *  3. The result is applied inline. Recomputation runs on hydration,
 *     text change, container resize (ResizeObserver — covers the mobile
 *     drawer opening, browser zoom and breakpoint changes) and once
 *     more after web fonts finish loading.
 *
 * RTL-safe: measurement is pure width math — direction independent.
 *
 * SSR-safe: the first client render matches the server output (text at
 * maxPx); the first adjustment happens in useLayoutEffect, BEFORE
 * paint, so users never see a flash of overflowing text.
 */

const MEASURE_PX = 100;
/** 0.5% slack so sub-pixel rounding never triggers the ellipsis. */
const FIT_SAFETY = 0.995;

interface FitTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Largest allowed size in px — short names keep this size. */
  maxPx: number;
  /** Readable floor in px — below this the label truncates instead. */
  minPx?: number;
  /** The label text itself — a single string by design. */
  children: string;
}

export function FitText({
  maxPx,
  minPx = 10,
  children,
  className,
  title,
  ...rest
}: FitTextProps) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const probeRef = React.useRef<HTMLSpanElement | null>(null);
  const [fontPx, setFontPx] = React.useState(maxPx);

  const recompute = React.useCallback(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;
    const available = box.clientWidth;
    if (available <= 0) return;
    const natural = probe.offsetWidth;
    if (natural <= 0) return;
    const exact = ((available * FIT_SAFETY) / natural) * MEASURE_PX;
    const next = Math.min(maxPx, Math.max(minPx, exact));
    setFontPx((current) => (Math.abs(current - next) > 0.1 ? next : current));
  }, [maxPx, minPx]);

  // Measure before paint on mount and whenever the text changes.
  React.useLayoutEffect(() => {
    recompute();
  }, [recompute, children]);

  // Track the CONTAINER, not the window (drawer opening, zoom, …).
  React.useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(box);
    return () => observer.disconnect();
  }, [recompute]);

  // Re-measure once the real web font replaces the fallback face.
  React.useEffect(() => {
    const fonts = (
      document as Document & { fonts?: { ready: Promise<unknown> } }
    ).fonts;
    if (!fonts) return;
    fonts.ready
      .then(() => recompute())
      .catch(() => undefined);
  }, [recompute]);

  // Only at the readable floor may the ellipsis appear.
  const clamped = fontPx <= minPx + 0.05;

  return (
    <div
      ref={boxRef}
      title={title}
      className="relative w-full min-w-0 overflow-hidden"
    >
      <span
        ref={probeRef}
        aria-hidden="true"
        className={cn(className, "invisible absolute start-0 top-0 whitespace-pre")}
        style={{ fontSize: `${MEASURE_PX}px` }}
      >
        {children}
      </span>
      <span
        className={cn(className, "block whitespace-nowrap", clamped && "truncate")}
        style={{ fontSize: `${fontPx}px` }}
        {...rest}
      >
        {children}
      </span>
    </div>
  );
}