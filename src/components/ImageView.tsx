import { TriangleAlert } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { fileUrl } from "../lib/api";
import { TileRenderer } from "../lib/tileRenderer";
import type { ApiError, ImageInfo } from "../lib/types";
import {
  type Size,
  type ViewTransform,
  clampCenter,
  fitScale,
  nextZoomStep,
  panBy,
  zoomAt,
} from "../lib/viewMath";
import { Button, Spinner } from "./ui";

export interface ImageViewHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  actualSize(): void;
  rotate(dir: 1 | -1): void;
  flip(axis: "h" | "v"): void;
  pan(dx: number, dy: number): void;
}

export type ZoomMode = "fit" | "custom";

interface Props {
  info: ImageInfo | null;
  loading: boolean;
  error: ApiError | null;
  pixelated: boolean;
  enlargeSmall: boolean;
  smooth: boolean;
  onScaleChange: (scale: number, mode: ZoomMode) => void;
  onRetry: () => void;
  onRevealInExplorer: () => void;
}

/**
 * Image viewer surface. Large/static images are drawn by TileRenderer from backend-decoded tiles;
 * animated images and SVG are drawn by an <img> element positioned with the same transform math.
 */
export const ImageView = forwardRef<ImageViewHandle, Props>(function ImageView(
  { info, loading, error, pixelated, enlargeSmall, smooth, onScaleChange, onRetry, onRevealInExplorer },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const rendererRef = useRef<TileRenderer | null>(null);
  const tRef = useRef<ViewTransform>({ scale: 1, cx: 0, cy: 0, rotation: 0, flipH: false, flipV: false });
  const viewRef = useRef<Size>({ width: 1, height: 1 });
  const modeRef = useRef<ZoomMode>("fit");
  const dprRef = useRef(window.devicePixelRatio || 1);
  const [painted, setPainted] = useState(false);
  const [tileError, setTileError] = useState<string | null>(null);
  const [elemTick, setElemTick] = useState(0);
  const animMs = smooth ? 220 : 0;

  const isElement = info?.render === "element";

  const notify = useCallback(
    (t: ViewTransform) => {
      tRef.current = t;
      onScaleChange(t.scale / dprRef.current, modeRef.current);
      if (isElement) setElemTick((x) => x + 1);
    },
    [onScaleChange, isElement],
  );

  // Renderer lifecycle
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const r = new TileRenderer(canvas, {
      pixelatedZoom: pixelated,
      onTransform: (t) => notify(t),
      onFirstPaint: () => setPainted(true),
      onTileError: (e) => setTileError(e),
    });
    rendererRef.current = r;
    return () => {
      r.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.opts.onTransform = (t) => notify(t);
  }, [notify]);

  useEffect(() => rendererRef.current?.setPixelated(pixelated), [pixelated]);

  const fitTransform = useCallback(
    (rotation: number, flipH: boolean, flipV: boolean): ViewTransform => {
      const v = viewRef.current;
      if (!info) return { scale: 1, cx: 0, cy: 0, rotation, flipH, flipV };
      const s = fitScale(info, { width: v.width / dprRef.current, height: v.height / dprRef.current }, rotation, enlargeSmall) * dprRef.current;
      return { scale: s, cx: info.width / 2, cy: info.height / 2, rotation, flipH, flipV };
    },
    [info, enlargeSmall],
  );

  const apply = useCallback(
    (t: ViewTransform, animate: boolean) => {
      const r = rendererRef.current;
      if (!r || !info) return;
      const clamped = clampCenter(t, info, viewRef.current);
      if (animate && animMs) r.animateTo(clamped, animMs);
      else r.setTransform(clamped);
    },
    [info, animMs],
  );

  // New image → reset view to fit.
  useEffect(() => {
    setPainted(false);
    setTileError(null);
    modeRef.current = "fit";
    const r = rendererRef.current;
    if (!r) return;
    r.setImage(info && info.render === "tiles" ? info : null);
    if (info) {
      const t = fitTransform(0, false, false);
      r.setTransform(t);
      if (info.render === "element") setPainted(true);
    }
  }, [info, fitTransform]);

  // Resize handling (device-pixel exact canvas).
  useEffect(() => {
    const host = hostRef.current!;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const box = e.devicePixelContentBoxSize?.[0];
      const w = box ? box.inlineSize : Math.round(e.contentRect.width * dpr);
      const h = box ? box.blockSize : Math.round(e.contentRect.height * dpr);
      viewRef.current = { width: w, height: h };
      const r = rendererRef.current;
      if (!r) return;
      r.resize(w, h);
      if (info) {
        if (modeRef.current === "fit") r.setTransform(fitTransform(r.t.rotation, r.t.flipH, r.t.flipV));
        else r.setTransform(clampCenter(r.t, info, viewRef.current));
      }
    });
    try {
      ro.observe(host, { box: "device-pixel-content-box" });
    } catch {
      ro.observe(host);
    }
    return () => ro.disconnect();
  }, [info, fitTransform]);

  // Imperative API for toolbar & keyboard shortcuts
  useImperativeHandle(
    ref,
    () => ({
      zoomIn() {
        const r = rendererRef.current;
        if (!r || !info) return;
        modeRef.current = "custom";
        const v = viewRef.current;
        const target = nextZoomStep(r.t.scale / dprRef.current, 1) * dprRef.current;
        if (animMs) r.animateZoomAt(target, v.width / 2, v.height / 2, animMs);
        else apply(zoomAt(r.t, target, v.width / 2, v.height / 2, v), false);
      },
      zoomOut() {
        const r = rendererRef.current;
        if (!r || !info) return;
        modeRef.current = "custom";
        const v = viewRef.current;
        const target = nextZoomStep(r.t.scale / dprRef.current, -1) * dprRef.current;
        const next = clampCenter(zoomAt(r.t, target, v.width / 2, v.height / 2, v), info, v);
        apply(next, true);
      },
      fit() {
        const r = rendererRef.current;
        if (!r) return;
        modeRef.current = "fit";
        apply(fitTransform(r.t.rotation, r.t.flipH, r.t.flipV), true);
      },
      actualSize() {
        const r = rendererRef.current;
        if (!r || !info) return;
        modeRef.current = "custom";
        // 100% = one image pixel per *device* pixel (true actual size on high-DPI screens).
        apply({ ...r.t, scale: 1 }, true);
      },
      rotate(dir) {
        const r = rendererRef.current;
        if (!r || !info) return;
        const rotation = (r.t.rotation + dir * 90 + 360) % 360;
        if (modeRef.current === "fit") r.setTransform(fitTransform(rotation, r.t.flipH, r.t.flipV));
        else r.setTransform(clampCenter({ ...r.t, rotation }, info, viewRef.current));
      },
      flip(axis) {
        const r = rendererRef.current;
        if (!r || !info) return;
        // Flip is applied in *view* orientation, so swap axes when rotated by 90/270.
        const swap = r.t.rotation % 180 !== 0;
        const h = axis === "h" ? !swap : swap;
        r.setTransform({ ...r.t, flipH: h ? !r.t.flipH : r.t.flipH, flipV: h ? r.t.flipV : !r.t.flipV });
      },
      pan(dx, dy) {
        const r = rendererRef.current;
        if (!r || !info) return;
        modeRef.current = "custom";
        const d = dprRef.current;
        apply(panBy(r.t, dx * d, dy * d), false);
      },
    }),
    [info, apply, fitTransform, animMs],
  );

  // Pointer interaction: wheel zoom at cursor, drag to pan, double-click toggles fit/100%.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const onWheel = (e: React.WheelEvent) => {
    const r = rendererRef.current;
    if (!r || !info) return;
    const d = dprRef.current;
    const rect = hostRef.current!.getBoundingClientRect();
    const vx = (e.clientX - rect.left) * d;
    const vy = (e.clientY - rect.top) * d;
    modeRef.current = "custom";
    // Smooth, continuous zoom for trackpads & mice (deltaMode 0 = pixels).
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const factor = Math.exp(-delta * 0.0018);
    const base = r.animating ? r.t : r.t;
    const next = clampCenter(zoomAt(base, base.scale * factor, vx, vy, viewRef.current), info, viewRef.current);
    r.setTransform(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = drag.current;
    const r = rendererRef.current;
    if (!g || !r || !info) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 2) return;
    g.moved = true;
    g.x = e.clientX;
    g.y = e.clientY;
    modeRef.current = "custom";
    const d = dprRef.current;
    r.setTransform(clampCenter(panBy(r.t, dx * d, dy * d), info, viewRef.current));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const r = rendererRef.current;
    if (!r || !info) return;
    const d = dprRef.current;
    const rect = hostRef.current!.getBoundingClientRect();
    const fit = fitTransform(r.t.rotation, r.t.flipH, r.t.flipV);
    if (modeRef.current === "fit" || Math.abs(r.t.scale - fit.scale) < 1e-3) {
      modeRef.current = "custom";
      const target = Math.abs(fit.scale - 1) < 0.05 ? 2 : 1;
      const vx = (e.clientX - rect.left) * d;
      const vy = (e.clientY - rect.top) * d;
      const next = clampCenter(zoomAt(r.t, target, vx, vy, viewRef.current), info, viewRef.current);
      apply(next, true);
    } else {
      modeRef.current = "fit";
      apply(fit, true);
    }
  };

  // Element (animated / SVG) layout from the same transform.
  const elemStyle = (() => {
    void elemTick;
    if (!isElement || !info) return undefined;
    // Same mapping as the canvas: v = translate(viewCentre) · R · F · (p − c) · s   (CSS px)
    const t = tRef.current;
    const d = dprRef.current;
    const s = t.scale / d;
    const v = viewRef.current;
    return {
      left: 0,
      top: 0,
      width: info.width * s,
      height: info.height * s,
      transformOrigin: "0 0",
      transform: `translate(${v.width / 2 / d}px, ${v.height / 2 / d}px) rotate(${t.rotation}deg) scale(${t.flipH ? -1 : 1}, ${t.flipV ? -1 : 1}) translate(${-t.cx * s}px, ${-t.cy * s}px)`,
      imageRendering: pixelated && s >= 2 ? ("pixelated" as const) : ("auto" as const),
    };
  })();

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden"
      style={{ cursor: info ? (drag.current?.moved ? "grabbing" : "grab") : "default", touchAction: "none" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: painted && !isElement ? 1 : 0, transition: smooth ? "opacity 160ms ease-out" : undefined }}
      />
      {isElement && info && (
        <img
          ref={imgRef}
          src={fileUrl(info.path)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={elemStyle}
        />
      )}
      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner size={28} />
        </div>
      )}
      {(error || tileError) && !loading && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="animate-pop-in flex max-w-md flex-col items-center gap-3 rounded-xl border border-line bg-panel/95 p-7 text-center shadow-2xl backdrop-blur">
            <TriangleAlert size={30} strokeWidth={1.4} className="text-warn" />
            <div className="text-[15px] font-semibold">{errorTitle(error)}</div>
            <div className="text-[13px] leading-relaxed text-fg-muted">{error?.message ?? tileError}</div>
            {error?.detail && <div className="max-h-24 overflow-auto font-mono text-[11px] text-fg-subtle">{error.detail}</div>}
            <div className="mt-2 flex gap-2">
              <Button onClick={onRetry}>Try Again</Button>
              <Button variant="ghost" onClick={onRevealInExplorer}>
                Show in Explorer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function errorTitle(e: ApiError | null): string {
  switch (e?.kind) {
    case "not_found":
      return "File not found";
    case "permission_denied":
      return "Access denied";
    case "unsupported_format":
      return "Format not supported";
    case "unsupported_codec":
      return "Codec not supported";
    case "corrupt":
      return "This file appears to be damaged";
    case "out_of_memory":
      return "Image too large for available memory";
    default:
      return "Couldn't display this image";
  }
}
