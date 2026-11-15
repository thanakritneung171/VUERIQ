// Pure gallery-selection and swipe maths — kept framework-free so it can be unit-tested.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Geometry of the virtualized gallery content (coordinates relative to the virtual container). */
export interface GalleryLayout {
  isGrid: boolean;
  count: number;
  cols: number;
  /** Top padding before the first row. */
  padTop: number;
  /** Left padding before the first column (grid) / row inset (list). */
  padLeft: number;
  /** Full row pitch. */
  rowH: number;
  /** Grid: cell width and gap between cells. */
  cellW: number;
  gap: number;
  /** Visible height of an item inside its row (grid: thumbnail + label; list: row). */
  itemH: number;
  /** List: total content width. */
  width: number;
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function itemRect(i: number, l: GalleryLayout): Rect {
  const row = Math.floor(i / l.cols);
  const col = i % l.cols;
  if (l.isGrid) return { x: l.padLeft + col * (l.cellW + l.gap), y: l.padTop + row * l.rowH, w: l.cellW, h: l.itemH };
  return { x: l.padLeft, y: l.padTop + row * l.rowH, w: l.width - l.padLeft * 2, h: l.itemH };
}

/** Indices of items touched by a rubber-band rectangle. Only rows inside the band are visited. */
export function bandHits(band: Rect, l: GalleryLayout): number[] {
  if (l.count === 0 || band.w <= 0 || band.h <= 0) return [];
  const rows = Math.ceil(l.count / l.cols);
  const r0 = Math.max(0, Math.floor((band.y - l.padTop) / l.rowH));
  const r1 = Math.min(rows - 1, Math.floor((band.y + band.h - l.padTop) / l.rowH));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = 0; c < l.cols; c++) {
      const i = r * l.cols + c;
      if (i >= l.count) break;
      if (intersects(band, itemRect(i, l))) out.push(i);
    }
  }
  return out;
}

/** Inclusive index range between anchor and target, in either direction. */
export function rangeIndices(anchor: number, target: number): number[] {
  const [a, b] = anchor <= target ? [anchor, target] : [target, anchor];
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

export function toggled<T>(set: ReadonlySet<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

// ── Swipe ──

export type SwipeDecision = "keep" | "delete";

/**
 * Decide the outcome of a released swipe. Right = keep, left = delete.
 * Commits when dragged past ~28% of the card width (max 160 px) or flicked fast enough.
 * @param dx horizontal drag distance in px
 * @param vx release velocity in px/ms (positive = right)
 */
export function swipeOutcome(dx: number, vx: number, width: number): SwipeDecision | null {
  const threshold = Math.min(160, width * 0.28);
  const flick = Math.abs(vx) > 0.6 && Math.abs(dx) > 40 && Math.sign(vx) === Math.sign(dx);
  if (Math.abs(dx) < threshold && !flick) return null;
  return dx > 0 ? "keep" : "delete";
}
