// GPU-accelerated (Canvas 2D → Skia/GPU in Chromium) tiled image renderer.
//
// The backend decodes the full-resolution image once and builds a mip pyramid (level 0 = original,
// level n = 1/2^n). The renderer requests only the tiles that are visible at the chosen level,
// so a 100-megapixel photo costs no more GPU memory at "fit" than a screen-sized one, and 100%
// zoom is always drawn from original pixels (never from a thumbnail).

import { tileUrl } from "./api";
import type { ImageInfo } from "./types";
import {
  type Size,
  type ViewTransform,
  clampScale,
  pickLevel,
  visibleImageRect,
  zoomAt,
} from "./viewMath";

interface Tile {
  key: string;
  bitmap: ImageBitmap | null;
  bytes: number;
  pending: boolean;
  failed: boolean;
  /** region (in level pixels) actually contained in the bitmap, including overlap */
  rx0: number;
  ry0: number;
  rx1: number;
  ry1: number;
}

const MAX_CONCURRENT = 6;
const TILE_CACHE_BYTES = 384 * 1024 * 1024;

export interface RendererOptions {
  pixelatedZoom: boolean;
  onTransform?: (t: ViewTransform) => void;
  onFirstPaint?: () => void;
  onTileError?: (err: string) => void;
}

export class TileRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private info: ImageInfo | null = null;
  private generation = 0;
  private tiles = new Map<string, Tile>();
  private cacheBytes = 0;
  private inflight = 0;
  private queue: { key: string; level: number; tx: number; ty: number; prio: number }[] = [];
  private raf = 0;
  private anim: { start: number; dur: number; fn: (k: number) => ViewTransform } | null = null;
  private painted = false;
  view: Size = { width: 1, height: 1 };
  t: ViewTransform = { scale: 1, cx: 0, cy: 0, rotation: 0, flipH: false, flipV: false };
  opts: RendererOptions;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: false });
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.opts = opts;
  }

  setImage(info: ImageInfo | null): void {
    this.generation++;
    this.releaseAll();
    this.info = info;
    this.painted = false;
    this.anim = null;
    this.requestRender();
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.view = { width: w, height: h };
    this.requestRender();
  }

  setTransform(t: ViewTransform, notify = true): void {
    this.anim = null;
    this.t = { ...t, scale: clampScale(t.scale) };
    if (notify) this.opts.onTransform?.(this.t);
    this.requestRender();
  }

  /** Animate with an arbitrary interpolation function (k: 0→1, eased). */
  animate(fn: (k: number) => ViewTransform, durationMs: number): void {
    if (durationMs <= 0) {
      this.setTransform(fn(1));
      return;
    }
    this.anim = { start: performance.now(), dur: durationMs, fn };
    this.requestRender();
  }

  animateZoomAt(targetScale: number, vx: number, vy: number, durationMs: number): void {
    const start = { ...this.t };
    const s0 = Math.log(start.scale);
    const s1 = Math.log(clampScale(targetScale));
    this.animate((k) => zoomAt(start, Math.exp(s0 + (s1 - s0) * k), vx, vy, this.view), durationMs);
  }

  animateTo(target: ViewTransform, durationMs: number): void {
    const a = { ...this.t };
    const ls0 = Math.log(a.scale);
    const ls1 = Math.log(target.scale);
    this.animate(
      (k) => ({
        ...target,
        scale: Math.exp(ls0 + (ls1 - ls0) * k),
        cx: a.cx + (target.cx - a.cx) * k,
        cy: a.cy + (target.cy - a.cy) * k,
      }),
      durationMs,
    );
  }

  get animating(): boolean {
    return this.anim !== null;
  }

  setPixelated(v: boolean): void {
    this.opts.pixelatedZoom = v;
    this.requestRender();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.generation++;
    this.releaseAll();
    this.info = null;
  }

  requestRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.anim) {
      const raw = Math.min(1, (now - this.anim.start) / this.anim.dur);
      const k = 1 - Math.pow(1 - raw, 3); // easeOutCubic
      this.t = { ...this.anim.fn(k) };
      this.t.scale = clampScale(this.t.scale);
      this.opts.onTransform?.(this.t);
      if (raw >= 1) this.anim = null;
      else this.requestRender();
    }
    this.draw();
  };

  // ───────────────────────── tiles ─────────────────────────

  private releaseAll(): void {
    for (const tile of this.tiles.values()) tile.bitmap?.close();
    this.tiles.clear();
    this.cacheBytes = 0;
    this.queue = [];
  }

  private levelGrid(level: number) {
    const info = this.info!;
    const L = info.levels[level];
    const T = info.tileSize;
    return {
      lw: L.width,
      lh: L.height,
      cols: Math.ceil(L.width / T),
      rows: Math.ceil(L.height / T),
      fx: info.width / L.width,
      fy: info.height / L.height,
      T,
    };
  }

  private tileKey(level: number, tx: number, ty: number) {
    return `${level}/${tx}/${ty}`;
  }

  private request(level: number, tx: number, ty: number, prio: number): void {
    const key = this.tileKey(level, tx, ty);
    const existing = this.tiles.get(key);
    if (existing) {
      // touch for LRU
      this.tiles.delete(key);
      this.tiles.set(key, existing);
      return;
    }
    if (this.queue.some((q) => q.key === key)) return;
    this.queue.push({ key, level, tx, ty, prio });
  }

  private pump(): void {
    if (!this.info) return;
    this.queue.sort((a, b) => a.prio - b.prio);
    while (this.inflight < MAX_CONCURRENT && this.queue.length) {
      const q = this.queue.shift()!;
      if (this.tiles.has(q.key)) continue;
      this.load(q.key, q.level, q.tx, q.ty);
    }
  }

  private async load(key: string, level: number, tx: number, ty: number): Promise<void> {
    const info = this.info!;
    const gen = this.generation;
    const g = this.levelGrid(level);
    const ov = info.tileOverlap;
    const rx0 = Math.max(0, tx * g.T - ov);
    const ry0 = Math.max(0, ty * g.T - ov);
    const rx1 = Math.min(g.lw, (tx + 1) * g.T + ov);
    const ry1 = Math.min(g.lh, (ty + 1) * g.T + ov);
    const tile: Tile = { key, bitmap: null, bytes: 0, pending: true, failed: false, rx0, ry0, rx1, ry1 };
    this.tiles.set(key, tile);
    this.inflight++;
    try {
      const res = await fetch(tileUrl(info.id, level, tx, ty));
      if (!res.ok) throw new Error(await res.text());
      const buf = await res.arrayBuffer();
      const w = rx1 - rx0;
      const h = ry1 - ry0;
      if (buf.byteLength !== w * h * 4) throw new Error(`tile size mismatch (${buf.byteLength} vs ${w * h * 4})`);
      const data = new ImageData(new Uint8ClampedArray(buf), w, h);
      const bmp = await createImageBitmap(data, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
      if (gen !== this.generation) {
        bmp.close();
        return;
      }
      tile.bitmap = bmp;
      tile.bytes = w * h * 4;
      tile.pending = false;
      this.cacheBytes += tile.bytes;
      this.evict();
    } catch (e) {
      if (gen === this.generation) {
        tile.failed = true;
        tile.pending = false;
        this.opts.onTileError?.(String(e instanceof Error ? e.message : e));
      }
    } finally {
      this.inflight--;
      if (gen === this.generation) {
        this.requestRender();
      }
    }
  }

  private evict(): void {
    if (this.cacheBytes <= TILE_CACHE_BYTES) return;
    const topLevel = this.info ? this.info.levels.length - 1 : 0;
    for (const [key, tile] of this.tiles) {
      if (this.cacheBytes <= TILE_CACHE_BYTES * 0.8) break;
      if (tile.pending || key.startsWith(`${topLevel}/`)) continue;
      tile.bitmap?.close();
      this.cacheBytes -= tile.bytes;
      this.tiles.delete(key);
    }
  }

  // ───────────────────────── drawing ─────────────────────────

  private draw(): void {
    const ctx = this.ctx;
    const { width: vw, height: vh } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    const info = this.info;
    if (!info || info.render !== "tiles") return;

    const t = this.t;
    const s = t.scale;
    const level = pickLevel(s, info.levels.length);
    const top = info.levels.length - 1;
    const vis = visibleImageRect(t, this.view, info);

    // Orientation transform; integer translation keeps 100% zoom pixel-exact.
    const rad = (t.rotation * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const fx = t.flipH ? -1 : 1;
    const fy = t.flipV ? -1 : 1;
    ctx.setTransform(cos * fx, sin * fx, -sin * fy, cos * fy, Math.round(vw / 2), Math.round(vh / 2));

    const pixelated = this.opts.pixelatedZoom && s >= 2;
    ctx.imageSmoothingEnabled = !pixelated;
    ctx.imageSmoothingQuality = "high";

    // Always keep the smallest level resident: instant first paint & fallback while panning.
    const gTop = this.levelGrid(top);
    for (let ty = 0; ty < gTop.rows; ty++)
      for (let tx = 0; tx < gTop.cols; tx++) this.request(top, tx, ty, -1);

    const g = this.levelGrid(level);
    const tx0 = Math.max(0, Math.floor(vis.x0 / g.fx / g.T));
    const ty0 = Math.max(0, Math.floor(vis.y0 / g.fy / g.T));
    const tx1 = Math.min(g.cols - 1, Math.floor((vis.x1 - 1e-6) / g.fx / g.T));
    const ty1 = Math.min(g.rows - 1, Math.floor((vis.y1 - 1e-6) / g.fy / g.T));
    const ccx = (vis.x0 + vis.x1) / 2 / g.fx / g.T;
    const ccy = (vis.y0 + vis.y1) / 2 / g.fy / g.T;

    let allReady = true;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = this.tileKey(level, tx, ty);
        const tile = this.tiles.get(key);
        // image-space rect of this tile's core
        const ix0 = tx * g.T * g.fx;
        const iy0 = ty * g.T * g.fy;
        const ix1 = Math.min(info.width, (tx + 1) * g.T * g.fx);
        const iy1 = Math.min(info.height, (ty + 1) * g.T * g.fy);
        if (tile?.bitmap) {
          this.drawTile(tile, level, tx, ty, g);
        } else {
          allReady = false;
          if (!tile) this.request(level, tx, ty, Math.hypot(tx + 0.5 - ccx, ty + 0.5 - ccy));
          this.drawFallback(level + 1, ix0, iy0, ix1, iy1);
        }
      }
    }
    this.pump();
    if (!this.painted && (allReady || this.tiles.get(this.tileKey(top, 0, 0))?.bitmap)) {
      this.painted = true;
      this.opts.onFirstPaint?.();
    }
  }

  /** Map an image-space coordinate to the (rounded) device coordinate relative to the view centre. */
  private ex(ix: number): number {
    return Math.round((ix - this.t.cx) * this.t.scale);
  }
  private ey(iy: number): number {
    return Math.round((iy - this.t.cy) * this.t.scale);
  }

  private drawTile(tile: Tile, level: number, tx: number, ty: number, g: ReturnType<TileRenderer["levelGrid"]>): void {
    void level;
    const cx0 = tx * g.T;
    const cy0 = ty * g.T;
    const cx1 = Math.min(g.lw, cx0 + g.T);
    const cy1 = Math.min(g.lh, cy0 + g.T);
    const dx0 = this.ex(cx0 * g.fx);
    const dy0 = this.ey(cy0 * g.fy);
    const dx1 = this.ex(cx1 * g.fx);
    const dy1 = this.ey(cy1 * g.fy);
    if (dx1 <= dx0 || dy1 <= dy0) return;
    this.ctx.drawImage(tile.bitmap!, cx0 - tile.rx0, cy0 - tile.ry0, cx1 - cx0, cy1 - cy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
  }

  /** Fill an image-space rect from the best cached coarser level. */
  private drawFallback(fromLevel: number, ix0: number, iy0: number, ix1: number, iy1: number): void {
    const info = this.info!;
    for (let level = fromLevel; level < info.levels.length; level++) {
      const g = this.levelGrid(level);
      const tx0 = Math.floor(ix0 / g.fx / g.T);
      const ty0 = Math.floor(iy0 / g.fy / g.T);
      const tx1 = Math.min(g.cols - 1, Math.floor((ix1 - 1e-6) / g.fx / g.T));
      const ty1 = Math.min(g.rows - 1, Math.floor((iy1 - 1e-6) / g.fy / g.T));
      let complete = true;
      for (let ty = ty0; ty <= ty1 && complete; ty++)
        for (let tx = tx0; tx <= tx1; tx++)
          if (!this.tiles.get(this.tileKey(level, tx, ty))?.bitmap) {
            complete = false;
            break;
          }
      if (!complete) continue;
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.ex(ix0), this.ey(iy0), this.ex(ix1) - this.ex(ix0), this.ey(iy1) - this.ey(iy0));
      ctx.clip();
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) this.drawTile(this.tiles.get(this.tileKey(level, tx, ty))!, level, tx, ty, g);
      ctx.restore();
      return;
    }
  }
}
