import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Expand,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Info,
  LayoutGrid,
  Maximize,
  Minimize,
  MoreHorizontal,
  RotateCcw,
  RotateCw,
  Scan,
  Star,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageView,
  type ImageViewHandle,
  type ZoomMode,
} from "../components/ImageView";
import { InfoPanel } from "../components/InfoPanel";
import { IconButton, Menu, cx } from "../components/ui";
import { VideoView, type VideoViewHandle } from "../components/VideoView";
import { api, isTauri } from "../lib/api";
import { resolveShortcut } from "../lib/shortcuts";
import type { ApiError, ImageInfo, VideoState } from "../lib/types";
import { isFavorite, useApp } from "../store/app";

export function Viewer() {
  const viewer = useApp((s) => s.viewer)!;
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const favorites = useApp((s) => s.favorites);
  const toggleFavorite = useApp((s) => s.toggleFavorite);
  const closeViewer = useApp((s) => s.closeViewer);
  const step = useApp((s) => s.step);
  const goTo = useApp((s) => s.goTo);
  const fullscreen = useApp((s) => s.fullscreen);
  const quick = useApp((s) => s.quick);
  const deleteFiles = useApp((s) => s.deleteFiles);
  const setFullscreen = useApp((s) => s.setFullscreen);

  const file = viewer.items[viewer.index];
  const imageRef = useRef<ImageViewHandle>(null);
  const videoRef = useRef<VideoViewHandle>(null);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [retry, setRetry] = useState(0);
  const [chrome, setChrome] = useState(true);
  const chromeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevId = useRef<number | null>(null);

  const isVideo = file.kind === "video";

  // Decode the current image on a background thread; keep the previous one on screen until ready.
  useEffect(() => {
    if (isVideo) {
      setInfo(null);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .openImage(file.path)
      .then((i) => {
        if (!alive) {
          api.releaseImage(i.id).catch(() => {});
          return;
        }
        setInfo(i);
        setLoading(false);
        if (prevId.current !== null && prevId.current !== i.id)
          api.releaseImage(prevId.current).catch(() => {});
        prevId.current = i.id;
      })
      .catch((e) => {
        if (!alive) return;
        setInfo(null);
        setError(e as ApiError);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [file.path, isVideo, retry]);

  // Prefetch neighbours so ←/→ is instant.
  useEffect(() => {
    if (loading) return;
    const n = viewer.items.length;
    if (n < 2) return;
    const ids = [viewer.index + 1, viewer.index - 1].map((i) => (i + n) % n);
    const t = setTimeout(() => {
      for (const i of ids)
        if (viewer.items[i].kind === "image")
          api.prefetchImage(viewer.items[i].path).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [viewer.index, viewer.items, loading]);

  // Release decoded image when leaving the viewer.
  useEffect(
    () => () => {
      if (prevId.current !== null)
        api.releaseImage(prevId.current).catch(() => {});
    },
    [],
  );

  const toggleFullscreen = useCallback(async () => {
    const next = !useApp.getState().fullscreen;
    if (isTauri) await getCurrentWindow().setFullscreen(next);
    setFullscreen(next);
  }, [setFullscreen]);

  const exitFullscreen = useCallback(async () => {
    if (isTauri) await getCurrentWindow().setFullscreen(false);
    setFullscreen(false);
  }, [setFullscreen]);

  // Delete the current file (Recycle Bin, undoable) and continue with the next one.
  const deleting = useRef(false);
  const deleteCurrent = useCallback(async () => {
    if (deleting.current) return;
    deleting.current = true;
    try {
      // libmpv keeps the file open while it plays.
      if (file.kind === "video") await api.videoStop().catch(() => {});
      await deleteFiles([file.path]);
    } finally {
      deleting.current = false;
    }
  }, [file.path, file.kind, deleteFiles]);

  // Auto-hide toolbar in full screen.
  const pokeChrome = useCallback(() => {
    setChrome(true);
    clearTimeout(chromeTimer.current);
    if (useApp.getState().fullscreen)
      chromeTimer.current = setTimeout(() => setChrome(false), 2200);
  }, []);
  useEffect(() => {
    pokeChrome();
  }, [fullscreen, pokeChrome]);

  // Keyboard shortcuts (mapping lives in lib/shortcuts.ts)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest("input, textarea, select, [role=menu]")
      )
        return;
      const a = resolveShortcut(e, {
        isVideo,
        fullscreen: useApp.getState().fullscreen,
      });
      if (!a) return;
      const v = videoRef.current;
      const im = imageRef.current;
      switch (a.type) {
        // The quick viewer has no gallery to go back to; Esc only leaves full screen there.
        case "close":
          if (!useApp.getState().quick) closeViewer();
          break;
        case "exitFullscreen":
          exitFullscreen();
          break;
        case "toggleFullscreen":
          toggleFullscreen();
          break;
        case "toggleInfo":
          updateSettings({
            showInfoPanel: !useApp.getState().settings.showInfoPanel,
          });
          break;
        case "toggleFavorite":
          toggleFavorite(file.path);
          break;
        case "delete":
          deleteCurrent();
          break;
        case "step":
          step(a.delta);
          break;
        case "first":
          goTo(0);
          break;
        case "last":
          goTo(viewer.items.length - 1);
          break;
        case "zoomIn":
          im?.zoomIn();
          break;
        case "zoomOut":
          im?.zoomOut();
          break;
        case "fit":
          im?.fit();
          break;
        case "actualSize":
          im?.actualSize();
          break;
        case "rotate":
          im?.rotate(a.dir);
          break;
        case "flip":
          im?.flip(a.axis);
          break;
        case "pan":
          im?.pan(a.dx, a.dy);
          break;
        case "togglePlay":
          v?.togglePlay();
          break;
        case "seek":
          v?.seekRelative(a.seconds);
          break;
        case "seekStart":
          v?.seekAbsolute(0);
          break;
        case "volume":
          v?.changeVolume(a.delta);
          break;
        case "mute":
          v?.toggleMute();
          break;
        case "frameStep":
          v?.frameStep(a.dir);
          break;
        case "speed":
          v?.changeSpeed(a.dir);
          break;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    file.path,
    isVideo,
    viewer.items.length,
    step,
    goTo,
    closeViewer,
    toggleFullscreen,
    exitFullscreen,
    toggleFavorite,
    updateSettings,
    deleteCurrent,
  ]);

  const onScaleChange = useCallback((s: number, mode: ZoomMode) => {
    setScale(s);
    setZoomMode(mode);
  }, []);

  const fav = isFavorite(favorites, file.path);
  const bgClass =
    settings.viewerBackground === "checker"
      ? "bg-checker"
      : settings.viewerBackground === "black"
        ? "bg-black"
        : settings.viewerBackground === "white"
          ? "bg-white"
          : settings.viewerBackground === "gray"
            ? "bg-[#3a3b3f]"
            : "bg-bg";
  const bgStyle =
    settings.viewerBackground === "custom"
      ? { background: settings.customBackground }
      : undefined;
  const showInfo = settings.showInfoPanel && !fullscreen;
  const counter =
    viewer.items.length > 1
      ? `${viewer.index + 1} / ${viewer.items.length}`
      : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1" onMouseMove={pokeChrome}>
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div
          className={cx(
            "z-20 flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 transition-all duration-300",
            fullscreen &&
              "absolute inset-x-0 top-0 border-transparent bg-panel/85 backdrop-blur-md",
            fullscreen &&
              !chrome &&
              "pointer-events-none -translate-y-full opacity-0",
          )}
        >
          {quick ? (
            <IconButton
              label="Show folder in VUERIQ"
              onClick={() =>
                fullscreen ? exitFullscreen().then(closeViewer) : closeViewer()
              }
            >
              <LayoutGrid size={16} />
            </IconButton>
          ) : (
            <IconButton
              label="Back to gallery"
              shortcut="Esc"
              onClick={() =>
                fullscreen ? exitFullscreen().then(closeViewer) : closeViewer()
              }
            >
              <ArrowLeft size={17} />
            </IconButton>
          )}
          <IconButton
            label="Previous"
            shortcut="←"
            disabled={viewer.items.length < 2}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            label="Next"
            shortcut="→"
            disabled={viewer.items.length < 2}
            onClick={() => step(1)}
          >
            <ChevronRight size={18} />
          </IconButton>
          <div className="mx-2 flex min-w-0 items-baseline gap-2">
            <span
              className="truncate text-[13px] font-medium"
              title={file.path}
            >
              {file.name}
            </span>
            {counter && (
              <span className="shrink-0 text-[12px] tabular-nums text-fg-subtle">
                {counter}
              </span>
            )}
            {info && (
              <span className="hidden shrink-0 text-[12px] tabular-nums text-fg-subtle xl:inline">
                {info.width} × {info.height}
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-0.5">
            {!isVideo && (
              <>
                <IconButton
                  label="Zoom out"
                  shortcut="−"
                  disabled={!info}
                  onClick={() => imageRef.current?.zoomOut()}
                >
                  <ZoomOut size={17} />
                </IconButton>
                <button
                  type="button"
                  title="Zoom level — click for 100%"
                  disabled={!info}
                  onClick={() => imageRef.current?.actualSize()}
                  className="h-8 w-14 rounded-md text-center font-mono text-[12px] tabular-nums text-fg-muted hover:bg-fg/8 hover:text-fg disabled:opacity-35"
                >
                  {Math.round(scale * 100)}%
                </button>
                <IconButton
                  label="Zoom in"
                  shortcut="+"
                  disabled={!info}
                  onClick={() => imageRef.current?.zoomIn()}
                >
                  <ZoomIn size={17} />
                </IconButton>
                <IconButton
                  label="Fit to window"
                  shortcut="0"
                  active={zoomMode === "fit"}
                  disabled={!info}
                  onClick={() => imageRef.current?.fit()}
                >
                  <Expand size={16} />
                </IconButton>
                <IconButton
                  label="Actual size (100%)"
                  shortcut="1"
                  active={zoomMode !== "fit" && Math.abs(scale - 1) < 1e-3}
                  disabled={!info}
                  onClick={() => imageRef.current?.actualSize()}
                >
                  <Scan size={16} />
                </IconButton>
                <div className="mx-1.5 h-5 w-px bg-line" />
                <IconButton
                  label="Rotate left"
                  shortcut="L"
                  disabled={!info}
                  onClick={() => imageRef.current?.rotate(-1)}
                >
                  <RotateCcw size={16} />
                </IconButton>
                <IconButton
                  label="Rotate right"
                  shortcut="R"
                  disabled={!info}
                  onClick={() => imageRef.current?.rotate(1)}
                >
                  <RotateCw size={16} />
                </IconButton>
                <IconButton
                  label="Flip horizontal"
                  shortcut="H"
                  disabled={!info}
                  onClick={() => imageRef.current?.flip("h")}
                >
                  <FlipHorizontal2 size={16} />
                </IconButton>
                <IconButton
                  label="Flip vertical"
                  shortcut="V"
                  disabled={!info}
                  onClick={() => imageRef.current?.flip("v")}
                >
                  <FlipVertical2 size={16} />
                </IconButton>
                <div className="mx-1.5 h-5 w-px bg-line" />
              </>
            )}
            <IconButton
              label={fav ? "Remove from favorites" : "Add to favorites"}
              shortcut="S"
              onClick={() => toggleFavorite(file.path)}
              className={fav ? "text-warn hover:text-warn" : undefined}
            >
              <Star size={16} fill={fav ? "currentColor" : "none"} />
            </IconButton>
            <IconButton
              label="Delete (move to Recycle Bin)"
              shortcut="Del"
              onClick={deleteCurrent}
            >
              <Trash2 size={16} />
            </IconButton>
            <IconButton
              label="Information"
              shortcut="I"
              active={settings.showInfoPanel}
              onClick={() =>
                updateSettings({ showInfoPanel: !settings.showInfoPanel })
              }
            >
              <Info size={17} />
            </IconButton>
            <IconButton
              label={fullscreen ? "Exit full screen" : "Full screen"}
              shortcut="F"
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </IconButton>
            {!isVideo && (
              <Menu
                align="right"
                trigger={(p) => (
                  <IconButton label="More" {...p}>
                    <MoreHorizontal size={17} />
                  </IconButton>
                )}
                items={[
                  {
                    label: "Show in Explorer",
                    icon: <FolderOpen size={14} />,
                    onSelect: () => api.revealInExplorer(file.path),
                  },
                  {
                    label: "Copy file path",
                    onSelect: () => navigator.clipboard.writeText(file.path),
                  },
                  {
                    label: "Background: Default",
                    checked: settings.viewerBackground === "default",
                    onSelect: () =>
                      updateSettings({ viewerBackground: "default" }),
                    separatorBefore: true,
                  },
                  {
                    label: "Background: Black",
                    checked: settings.viewerBackground === "black",
                    onSelect: () =>
                      updateSettings({ viewerBackground: "black" }),
                  },
                  {
                    label: "Background: Gray",
                    checked: settings.viewerBackground === "gray",
                    onSelect: () =>
                      updateSettings({ viewerBackground: "gray" }),
                  },
                  {
                    label: "Background: White",
                    checked: settings.viewerBackground === "white",
                    onSelect: () =>
                      updateSettings({ viewerBackground: "white" }),
                  },
                  {
                    label: "Background: Checkerboard",
                    checked: settings.viewerBackground === "checker",
                    onSelect: () =>
                      updateSettings({ viewerBackground: "checker" }),
                  },
                ]}
              />
            )}
          </div>
        </div>

        {/* Stage */}
        <div
          className={cx("relative min-h-0 flex-1", !isVideo && bgClass)}
          style={!isVideo ? bgStyle : undefined}
        >
          {isVideo ? (
            <VideoView
              key="video"
              ref={videoRef}
              path={file.path}
              fullscreen={fullscreen}
              onToggleFullscreen={toggleFullscreen}
              onState={setVideoState}
              onRevealInExplorer={() => api.revealInExplorer(file.path)}
            />
          ) : (
            <ImageView
              ref={imageRef}
              info={info}
              loading={loading}
              error={error}
              pixelated={settings.pixelatedZoom}
              enlargeSmall={settings.enlargeSmallImages}
              smooth={settings.smoothTransitions}
              onScaleChange={onScaleChange}
              onRetry={() => setRetry((r) => r + 1)}
              onRevealInExplorer={() => api.revealInExplorer(file.path)}
            />
          )}
          {viewer.items.length > 1 && !isVideo && (
            <>
              <NavEdge side="left" onClick={() => step(-1)} />
              <NavEdge side="right" onClick={() => step(1)} />
            </>
          )}
        </div>
      </div>
      {showInfo && (
        <InfoPanel
          file={file}
          image={isVideo ? null : info}
          video={isVideo ? videoState : null}
          onClose={() => updateSettings({ showInfoPanel: false })}
        />
      )}
    </div>
  );
}

function NavEdge({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous" : "Next"}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cx(
        "group absolute top-1/2 z-10 flex h-24 w-12 -translate-y-1/2 items-center justify-center opacity-0 transition-opacity duration-200 hover:opacity-100",
        side === "left" ? "left-0" : "right-0",
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm">
        {side === "left" ? (
          <ChevronLeft size={22} />
        ) : (
          <ChevronRight size={22} />
        )}
      </span>
    </button>
  );
}
