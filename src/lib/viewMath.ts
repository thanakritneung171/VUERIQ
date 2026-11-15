// Pure view-transform math for the image viewer. No DOM access → unit-testable.
//
// Coordinate systems
//  - Image space: pixels of the (orientation-corrected) full-resolution image, origin top-left.
//  - View space:  device pixels of the viewport canvas, origin top-left.
// The view maps image → view as: v = R·F·(p − center)·scale + viewCenter
// where R is rotation by `rotation` degrees (multiple of 90) and F is the flip matrix.

export interface ViewTransform {
  /** device pixels per image pixel */
  scale: number;
  /** image-space point shown at viewport centre */
  cx: number;
  cy: number;
  /** 0 | 90 | 180 | 270 (clockwise) */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 64;

export const ZOOM_STEPS = [
  0.02, 0.03, 0.05, 0.0625, 0.08, 0.1, 0.125, 0.167, 0.2, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.25, 1.5, 2, 3,
  4, 6, 8, 12, 16, 24, 32, 48, 64,
];

export function normRotation(r: number): number {
  return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
}

/** Image size after rotation (what the user sees). */
export function rotatedSize(img: Size, rotation: number): Size {
  return normRotation(rotation) % 180 === 0 ? { ...img } : { width: img.height, height: img.width };
}

export function fitScale(img: Size, view: Size, rotation: number, enlarge: boolean, padding = 0): number {
  const r = rotatedSize(img, rotation);
  if (r.width <= 0 || r.height <= 0 || view.width <= 0 || view.height <= 0) return 1;
  const s = Math.min((view.width - padding * 2) / r.width, (view.height - padding * 2) / r.height);
  return Math.max(MIN_SCALE, enlarge ? s : Math.min(1, s));
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Rotate+flip a vector from image orientation into view orientation. */
export function orient(dx: number, dy: number, t: Pick<ViewTransform, "rotation" | "flipH" | "flipV">): [number, number] {
  let x = t.flipH ? -dx : dx;
  let y = t.flipV ? -dy : dy;
  switch (normRotation(t.rotation)) {
    case 90:
      [x, y] = [-y, x];
      break;
    case 180:
      [x, y] = [-x, -y];
      break;
    case 270:
      [x, y] = [y, -x];
      break;
  }
  return [x, y];
}

/** Inverse of `orient`: view-orientation vector → image-orientation vector. */
export function unorient(dx: number, dy: number, t: Pick<ViewTransform, "rotation" | "flipH" | "flipV">): [number, number] {
  let x = dx;
  let y = dy;
  switch (normRotation(t.rotation)) {
    case 90:
      [x, y] = [y, -x];
      break;
    case 180:
      [x, y] = [-x, -y];
      break;
    case 270:
      [x, y] = [-y, x];
      break;
  }
  if (t.flipH) x = -x;
  if (t.flipV) y = -y;
  return [x, y];
}

export function imageToView(px: number, py: number, t: ViewTransform, view: Size): [number, number] {
  const [ox, oy] = orient((px - t.cx) * t.scale, (py - t.cy) * t.scale, t);
  return [ox + view.width / 2, oy + view.height / 2];
}

export function viewToImage(vx: number, vy: number, t: ViewTransform, view: Size): [number, number] {
  const [ix, iy] = unorient(vx - view.width / 2, vy - view.height / 2, t);
  return [ix / t.scale + t.cx, iy / t.scale + t.cy];
}

/** Zoom to `newScale` keeping the image point under view point (vx, vy) fixed. */
export function zoomAt(t: ViewTransform, newScale: number, vx: number, vy: number, view: Size): ViewTransform {
  const s = clampScale(newScale);
  const [ix, iy] = viewToImage(vx, vy, t, view);
  // After zoom, (ix,iy) must map to (vx,vy): centre = ix − unorient(v − vc)/s
  const [ux, uy] = unorient(vx - view.width / 2, vy - view.height / 2, t);
  return { ...t, scale: s, cx: ix - ux / s, cy: iy - uy / s };
}

/** Pan by a view-space delta (device px). */
export function panBy(t: ViewTransform, dx: number, dy: number): ViewTransform {
  const [ix, iy] = unorient(dx, dy, t);
  return { ...t, cx: t.cx - ix / t.scale, cy: t.cy - iy / t.scale };
}

/**
 * Keep the image within reach: when the image is smaller than the viewport on an axis it is centred;
 * otherwise the viewport may not move past the image edge.
 */
export function clampCenter(t: ViewTransform, img: Size, view: Size): ViewTransform {
  const r = rotatedSize(img, t.rotation);
  // Work in "rotated image" space where axes align with the view.
  const [rcx, rcy] = orient(t.cx - img.width / 2, t.cy - img.height / 2, { ...t, flipH: t.flipH, flipV: t.flipV });
  const halfVW = view.width / 2 / t.scale;
  const halfVH = view.height / 2 / t.scale;
  const limX = Math.max(0, r.width / 2 - halfVW);
  const limY = Math.max(0, r.height / 2 - halfVH);
  const nx = Math.min(limX, Math.max(-limX, rcx));
  const ny = Math.min(limY, Math.max(-limY, rcy));
  if (nx === rcx && ny === rcy) return t;
  const [bx, by] = unorient(nx, ny, t);
  return { ...t, cx: bx + img.width / 2, cy: by + img.height / 2 };
}

export function nextZoomStep(current: number, dir: 1 | -1): number {
  if (dir > 0) {
    for (const z of ZOOM_STEPS) if (z > current * 1.001) return z;
    return MAX_SCALE;
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < current * 0.999) return ZOOM_STEPS[i];
  return MIN_SCALE;
}

/**
 * Choose the pyramid level for a given scale: the coarsest level whose resolution is still ≥ what is
 * displayed (so we always downsample, never upsample a reduced level). Level n has 1/2^n resolution.
 */
export function pickLevel(scale: number, levelCount: number): number {
  if (scale >= 1 || levelCount <= 1) return 0;
  const l = Math.floor(Math.log2(1 / scale) + 1e-9);
  return Math.max(0, Math.min(levelCount - 1, l));
}

/** Visible image-space rectangle (axis-aligned in image space) for the current transform. */
export function visibleImageRect(t: ViewTransform, view: Size, img: Size): { x0: number; y0: number; x1: number; y1: number } {
  const corners = [
    viewToImage(0, 0, t, view),
    viewToImage(view.width, 0, t, view),
    viewToImage(0, view.height, t, view),
    viewToImage(view.width, view.height, t, view),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x0: Math.max(0, Math.min(...xs)),
    y0: Math.max(0, Math.min(...ys)),
    x1: Math.min(img.width, Math.max(...xs)),
    y1: Math.min(img.height, Math.max(...ys)),
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
