// Step through a group without leaving the results (keeps the scroll position).
import { Check, ChevronLeft, ChevronRight, Maximize2, Play, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImageView } from "../../components/ImageView";
import { Thumb } from "../../components/Thumb";
import { Button, IconButton, cx } from "../../components/ui";
import { api, thumbUrl } from "../../lib/api";
import { formatBytes, formatDate } from "../../lib/formats";
import type { ApiError, DupFile, ImageInfo } from "../../lib/types";
import { useApp } from "../../store/app";
import { relFolder } from "./store";

export function Preview({
  files,
  index,
  sel,
  root,
  onIndex,
  onToggle,
  onClose,
  onOpenViewer,
}: {
  files: DupFile[];
  index: number;
  sel: Set<string>;
  root: string;
  onIndex: (i: number) => void;
  onToggle: (p: string) => void;
  onClose: () => void;
  onOpenViewer: () => void;
}) {
  const file = files[index];
  const selected = sel.has(file.path);
  const settings = useApp((s) => s.settings);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [retry, setRetry] = useState(0);
  const prevId = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (file.kind !== "image") {
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
        if (prevId.current !== null && prevId.current !== i.id) api.releaseImage(prevId.current).catch(() => {});
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
  }, [file.path, file.kind, retry]);

  useEffect(
    () => () => {
      if (prevId.current !== null) api.releaseImage(prevId.current).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    stripRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);

  const step = (d: number) => onIndex((index + d + files.length) % files.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useApp.getState().confirm || e.ctrlKey || e.metaKey || e.altKey) return;
      let handled = true;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === " " || e.key === "Delete") onToggle(file.path);
      else if (e.key === "Enter") onOpenViewer();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const folder = relFolder(root, file.path);
  return (
    <div role="dialog" aria-label={`Preview ${file.name}`} className="animate-fade-in absolute inset-0 z-30 flex flex-col bg-bg">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3">
        <IconButton label="Back to results" shortcut="Esc" onClick={onClose}>
          <ChevronLeft size={18} />
        </IconButton>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold" title={file.path}>
            {file.name}
          </div>
          <div className="truncate text-[11.5px] text-fg-subtle tabular-nums">
            {index + 1} / {files.length} · {file.width && file.height ? `${file.width}×${file.height} · ` : ""}
            {formatBytes(file.size)} · {formatDate(file.modified)}
            {folder ? ` · in ${folder}` : ""}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant={selected ? "danger" : "secondary"}
            className="h-8"
            icon={selected ? <Trash2 size={14} /> : <Check size={14} />}
            title="Toggle keep / remove  (Space)"
            onClick={() => onToggle(file.path)}
          >
            {selected ? "Will be removed" : "Keep"}
          </Button>
          <IconButton label="Open in full viewer" shortcut="Enter" onClick={onOpenViewer}>
            <Maximize2 size={16} />
          </IconButton>
          <IconButton label="Close preview" shortcut="Esc" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {file.kind === "image" ? (
          <ImageView
            info={info}
            loading={loading}
            error={error}
            pixelated={settings.pixelatedZoom}
            enlargeSmall={settings.enlargeSmallImages}
            smooth={settings.smoothTransitions}
            onScaleChange={() => {}}
            onRetry={() => setRetry((r) => r + 1)}
            onRevealInExplorer={() => api.revealInExplorer(file.path)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
            <img src={thumbUrl(file.path, 1024, file.modified)} alt="" draggable={false} className="max-h-[80%] max-w-full rounded-lg object-contain" />
            <Button variant="secondary" icon={<Play size={14} />} onClick={onOpenViewer}>
              Play in viewer
            </Button>
          </div>
        )}
        {files.length > 1 && (
          <>
            <PreviewEdge side="left" onClick={() => step(-1)} />
            <PreviewEdge side="right" onClick={() => step(1)} />
          </>
        )}
      </div>

      {files.length > 1 && (
        <div ref={stripRef} className="flex shrink-0 gap-2 overflow-x-auto border-t border-line px-3 py-2">
          {files.map((f, i) => (
            <button
              key={f.path}
              type="button"
              data-i={i}
              title={f.name}
              onClick={() => onIndex(i)}
              className={cx(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 bg-panel",
                i === index ? "border-accent" : sel.has(f.path) ? "border-danger/60" : "border-transparent hover:border-line-strong",
              )}
            >
              <Thumb file={f} size={64} className={cx("h-full w-full", sel.has(f.path) && "opacity-50")} />
              {sel.has(f.path) && (
                <span className="absolute top-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded bg-danger text-white">
                  <Trash2 size={9} strokeWidth={2.5} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PreviewEdge({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous" : "Next"}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cx(
        "absolute top-1/2 z-10 flex h-24 w-12 -translate-y-1/2 items-center justify-center opacity-40 transition-opacity duration-200 hover:opacity-100",
        side === "left" ? "left-0" : "right-0",
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm">
        {side === "left" ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
      </span>
    </button>
  );
}
