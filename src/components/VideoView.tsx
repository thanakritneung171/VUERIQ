import { listen } from "@tauri-apps/api/event";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { formatTime } from "../lib/formats";
import type { ApiError, VideoState } from "../lib/types";
import { useApp } from "../store/app";
import { Button, IconButton, Menu, Spinner, cx } from "./ui";

export interface VideoViewHandle {
  togglePlay(): void;
  seekRelative(sec: number): void;
  seekAbsolute(sec: number): void;
  frameStep(dir: 1 | -1): void;
  changeVolume(delta: number): void;
  toggleMute(): void;
  changeSpeed(dir: 1 | -1 | 0): void;
}

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];

const EMPTY: VideoState = {
  available: true,
  loaded: false,
  path: null,
  paused: false,
  timePos: 0,
  duration: 0,
  volume: 80,
  mute: false,
  speed: 1,
  eof: false,
  width: 0,
  height: 0,
  fps: 0,
  videoCodec: null,
  audioCodec: null,
  hwdec: null,
  frameReady: false,
  seekable: true,
  error: null,
};

interface Props {
  path: string;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onState?: (s: VideoState) => void;
  onRevealInExplorer: () => void;
}

/**
 * Video surface. The libmpv engine renders into the native window *behind* the transparent WebView;
 * this component keeps a transparent "stage" and tells the engine where it is (as margins), then
 * draws HTML controls over the video.
 */
export const VideoView = forwardRef<VideoViewHandle, Props>(function VideoView(
  { path, fullscreen, onToggleFullscreen, onState, onRevealInExplorer },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<VideoState>(EMPTY);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrub, setScrub] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const stRef = useRef(st);
  stRef.current = st;

  // Engine events
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<VideoState>("video-state", (e) => {
      setSt(e.payload);
      onState?.(e.payload);
    }).then((u) => (un = u));
    return () => un?.();
  }, [onState]);

  // Load / unload
  useEffect(() => {
    setLoadError(null);
    setSt({ ...EMPTY, volume: settings.videoVolume });
    api
      .videoLoad(path, { volume: settings.videoVolume, hwdec: settings.videoHwdec, loop: settings.videoLoop })
      .catch((e) => setLoadError(e as ApiError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => () => void api.videoStop().catch(() => {}), []);

  // Keep the engine's video rectangle glued to the stage.
  useLayoutEffect(() => {
    const el = stageRef.current!;
    const update = () => {
      const r = el.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (W <= 0 || H <= 0) return;
      api
        .videoSetMargins(
          Math.max(0, r.left / W),
          Math.max(0, r.top / H),
          Math.max(0, (W - r.right) / W),
          Math.max(0, (H - r.bottom) / H),
        )
        .catch(() => {});
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    update();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [fullscreen]);

  // Persist volume changes
  useEffect(() => {
    if (st.loaded && Math.round(st.volume) !== settings.videoVolume) {
      const t = setTimeout(() => updateSettings({ videoVolume: Math.round(st.volume) }), 600);
      return () => clearTimeout(t);
    }
  }, [st.volume, st.loaded, settings.videoVolume, updateSettings]);

  const poke = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!stRef.current.paused) setControlsVisible(false);
    }, 2600);
  }, []);

  useEffect(() => {
    poke();
    return () => clearTimeout(hideTimer.current);
  }, [poke]);

  useEffect(() => {
    if (st.paused) setControlsVisible(true);
  }, [st.paused]);

  const cmd = (name: string, ...args: string[]) => api.videoCommand(name, args).catch(() => {});
  const setProp = (name: string, value: string) => api.videoSetProperty(name, value).catch(() => {});

  const handle: VideoViewHandle = {
    togglePlay() {
      poke();
      if (stRef.current.eof) cmd("seek", "0", "absolute").then(() => setProp("pause", "no"));
      else cmd("cycle", "pause");
    },
    seekRelative(sec) {
      poke();
      cmd("seek", String(sec), "relative+exact");
    },
    seekAbsolute(sec) {
      poke();
      cmd("seek", String(sec), "absolute+exact");
    },
    frameStep(dir) {
      poke();
      cmd(dir > 0 ? "frame-step" : "frame-back-step");
    },
    changeVolume(delta) {
      poke();
      const v = Math.max(0, Math.min(130, stRef.current.volume + delta));
      setProp("volume", String(v));
      if (stRef.current.mute && delta > 0) setProp("mute", "no");
    },
    toggleMute() {
      poke();
      cmd("cycle", "mute");
    },
    changeSpeed(dir) {
      poke();
      if (dir === 0) return void setProp("speed", "1");
      const cur = stRef.current.speed;
      const idx = SPEEDS.findIndex((s) => Math.abs(s - cur) < 1e-3);
      const next = idx < 0 ? 1 : SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + dir))];
      setProp("speed", String(next));
    },
  };
  useImperativeHandle(ref, () => handle);

  const error = loadError ?? (st.error ? ({ kind: "unsupported_codec", message: st.error } as ApiError) : null);
  const engineMissing = loadError?.kind === "engine_unavailable";
  const pos = scrub ?? st.timePos;
  const pct = st.duration > 0 ? Math.min(100, (pos / st.duration) * 100) : 0;
  const VolIcon = st.mute || st.volume === 0 ? VolumeX : st.volume < 50 ? Volume1 : Volume2;

  return (
    <div
      className={cx("relative h-full w-full", !controlsVisible && "cursor-none")}
      onMouseMove={poke}
      onMouseLeave={() => !st.paused && setControlsVisible(false)}
    >
      {/* Transparent stage: the engine draws here. Black until the first frame is ready. */}
      <div
        ref={stageRef}
        className={cx("absolute inset-0 transition-colors duration-200", st.frameReady && !error ? "bg-transparent" : "bg-black")}
        onClick={() => !error && handle.togglePlay()}
        onDoubleClick={onToggleFullscreen}
      />

      {!st.frameReady && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner size={28} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg p-8">
          <div className="animate-pop-in flex max-w-md flex-col items-center gap-3 rounded-xl border border-line bg-panel p-7 text-center shadow-2xl">
            <TriangleAlert size={30} strokeWidth={1.4} className="text-warn" />
            <div className="text-[15px] font-semibold">{engineMissing ? "Video engine not available" : "Can't play this video"}</div>
            <div className="text-[13px] leading-relaxed text-fg-muted">{error.message}</div>
            {error.detail && <div className="max-h-24 overflow-auto font-mono text-[11px] text-fg-subtle">{error.detail}</div>}
            <div className="mt-2 flex gap-2">
              <Button
                onClick={() => {
                  setLoadError(null);
                  api.videoLoad(path, { volume: settings.videoVolume, hwdec: settings.videoHwdec, loop: settings.videoLoop }).catch((e) => setLoadError(e as ApiError));
                }}
              >
                Try Again
              </Button>
              <Button variant="ghost" onClick={onRevealInExplorer}>
                Show in Explorer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      {!error && (
        <div
          className={cx(
            "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-5 pt-12 pb-3 text-white transition-opacity duration-300",
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <div className="flex items-center gap-3">
            <span className="w-14 text-right font-mono text-[11.5px] tabular-nums text-white/85">{formatTime(pos)}</span>
            <input
              type="range"
              aria-label="Seek"
              className="vq-range flex-1"
              min={0}
              max={st.duration || 0}
              step={0.01}
              value={Math.min(pos, st.duration || 0)}
              disabled={!st.seekable || !st.duration}
              style={{ ["--vq-fill" as string]: `${pct}%` }}
              onChange={(e) => {
                const v = Number(e.target.value);
                setScrub(v);
                cmd("seek", String(v), "absolute+keyframes");
              }}
              onPointerUp={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                cmd("seek", String(v), "absolute+exact");
                setScrub(null);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="w-14 font-mono text-[11.5px] tabular-nums text-white/60">{formatTime(st.duration)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <CtlButton label="Previous frame" shortcut="," onClick={() => cmd("frame-back-step")}>
              <ChevronLeft size={18} />
            </CtlButton>
            <CtlButton label={st.paused || st.eof ? "Play" : "Pause"} shortcut="Space" onClick={() => handle.togglePlay()} big>
              {st.paused || st.eof ? <Play size={20} fill="currentColor" strokeWidth={0} /> : <Pause size={20} fill="currentColor" strokeWidth={0} />}
            </CtlButton>
            <CtlButton label="Next frame" shortcut="." onClick={() => cmd("frame-step")}>
              <ChevronRight size={18} />
            </CtlButton>
            <div className="ml-2 flex items-center gap-1.5">
              <CtlButton label={st.mute ? "Unmute" : "Mute"} shortcut="M" onClick={() => cmd("cycle", "mute")}>
                <VolIcon size={18} />
              </CtlButton>
              <input
                type="range"
                aria-label="Volume"
                className="vq-range w-24"
                min={0}
                max={100}
                step={1}
                value={st.mute ? 0 : Math.min(100, st.volume)}
                style={{ ["--vq-fill" as string]: `${st.mute ? 0 : Math.min(100, st.volume)}%` }}
                onChange={(e) => {
                  setProp("volume", e.target.value);
                  if (st.mute) setProp("mute", "no");
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="w-8 text-[11px] tabular-nums text-white/60">{st.mute ? "—" : Math.round(st.volume)}</span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {st.width > 0 && (
                <span className="mr-2 hidden text-[11px] text-white/55 lg:inline">
                  {st.width}×{st.height}
                  {st.fps ? ` · ${st.fps.toFixed(st.fps % 1 ? 2 : 0)} fps` : ""}
                  {st.videoCodec ? ` · ${st.videoCodec}` : ""}
                </span>
              )}
              <CtlButton
                label={settings.videoLoop ? "Loop on" : "Loop off"}
                onClick={() => {
                  const v = !settings.videoLoop;
                  updateSettings({ videoLoop: v });
                  setProp("loop-file", v ? "inf" : "no");
                }}
                active={settings.videoLoop}
              >
                <Repeat size={16} />
              </CtlButton>
              <Menu
                side="top"
                align="right"
                trigger={(p) => (
                  <button
                    type="button"
                    {...p}
                    title="Playback speed  ([ / ])"
                    className="h-8 rounded-md px-2 font-mono text-[12px] text-white/85 hover:bg-white/12 hover:text-white"
                  >
                    {st.speed.toFixed(st.speed % 1 ? 2 : 0).replace(/0$/, "")}×
                  </button>
                )}
                items={SPEEDS.map((s) => ({
                  label: s === 1 ? "Normal" : `${s}×`,
                  checked: Math.abs(st.speed - s) < 1e-3,
                  onSelect: () => setProp("speed", String(s)),
                }))}
              />
              <CtlButton label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F" onClick={onToggleFullscreen}>
                {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
              </CtlButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function CtlButton({
  label,
  shortcut,
  onClick,
  children,
  big,
  active,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
  big?: boolean;
  active?: boolean;
}) {
  return (
    <IconButton
      label={label}
      shortcut={shortcut}
      onClick={onClick}
      className={cx("text-white/85 hover:bg-white/12 hover:text-white", big && "h-9 w-9", active && "text-accent")}
    >
      {children}
    </IconButton>
  );
}
