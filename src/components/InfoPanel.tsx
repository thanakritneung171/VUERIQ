import { Copy, FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { FileEntry, ImageInfo, MetaGroup, VideoState } from "../lib/types";
import { IconButton, Spinner } from "./ui";

export function InfoPanel({
  file,
  image,
  video,
  onClose,
}: {
  file: FileEntry;
  image: ImageInfo | null;
  video: VideoState | null;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<MetaGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setGroups(null);
    setError(null);
    api
      .metadata(file.path)
      .then((m) => alive && setGroups(m.groups))
      .catch((e) => alive && setError(e.message ?? String(e)));
    return () => {
      alive = false;
    };
  }, [file.path]);

  const rendering: MetaGroup | null = image
    ? {
        title: "Rendering",
        items: [
          { label: "Decoder", value: image.decoder },
          { label: "Decode time", value: `${image.decodeMs} ms` },
          { label: "Color", value: image.colorManaged ? `Managed → sRGB${image.colorProfile ? ` (${image.colorProfile})` : ""}` : "sRGB (no embedded profile)" },
          { label: "Bit depth", value: `${image.bitDepth}-bit source` },
          { label: "Orientation", value: image.orientation > 1 ? `EXIF ${image.orientation} (corrected)` : "Normal" },
          { label: "Pyramid", value: `${image.levels.length} level${image.levels.length > 1 ? "s" : ""}, ${image.tileSize}px tiles` },
          ...image.notes.map((n) => ({ label: "Note", value: n })),
        ],
      }
    : null;

  const playback: MetaGroup | null =
    video && video.loaded
      ? {
          title: "Playback",
          items: [
            { label: "Resolution", value: video.width ? `${video.width} × ${video.height}` : "—" },
            { label: "Frame rate", value: video.fps ? `${video.fps.toFixed(3)} fps` : "—" },
            { label: "Video codec", value: video.videoCodec ?? "—" },
            { label: "Audio codec", value: video.audioCodec ?? "None" },
            { label: "Hardware decoding", value: video.hwdec && video.hwdec !== "no" ? video.hwdec : "Off (software)" },
          ],
        }
      : null;

  const all = [...(groups ?? []), ...(rendering ? [rendering] : []), ...(playback ? [playback] : [])];

  return (
    <aside className="animate-fade-in flex w-[300px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
        <span className="text-[13px] font-semibold">Information</span>
        <IconButton label="Close information" shortcut="I" size="sm" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-4 break-all text-[13px] leading-snug font-medium select-text">{file.name}</div>
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-fg/5 hover:text-fg"
            onClick={() => api.revealInExplorer(file.path)}
          >
            <FolderOpen size={13} /> Show in Explorer
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-fg/5 hover:text-fg"
            onClick={() => navigator.clipboard.writeText(file.path)}
          >
            <Copy size={13} /> Copy path
          </button>
        </div>
        {!groups && !error && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {error && <div className="mb-3 text-[12px] text-warn">{error}</div>}
        {all.map((g) => (
          <section key={g.title} className="mb-5">
            <h3 className="mb-2 text-[10.5px] font-semibold tracking-[0.12em] text-fg-subtle uppercase">{g.title}</h3>
            <dl className="space-y-1.5">
              {g.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[96px_1fr] gap-2 text-[12px]">
                  <dt className="text-fg-subtle">{it.label}</dt>
                  <dd className="break-words text-fg select-text">{it.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </aside>
  );
}
