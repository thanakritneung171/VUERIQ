import { FileVideo, ImageOff, Play } from "lucide-react";
import { memo, useState } from "react";
import { thumbUrl } from "../lib/api";
import type { FileEntry } from "../lib/types";
import { cx } from "./ui";

/** Async, disk-cached thumbnail. The browser only requests it once the cell is mounted (virtualized). */
export const Thumb = memo(function Thumb({ file, size, className }: { file: FileEntry; size: number; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  // Request at device resolution, bucketed so the disk cache is reused across sizes.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bucket = size * dpr <= 192 ? 192 : size * dpr <= 320 ? 320 : 480;
  return (
    <div className={cx("relative flex items-center justify-center overflow-hidden", className)}>
      {state === "loading" && <div className="skeleton absolute inset-0" />}
      {state === "error" ? (
        <div className="flex flex-col items-center gap-1.5 text-fg-subtle">
          {file.kind === "video" ? <FileVideo size={26} strokeWidth={1.5} /> : <ImageOff size={24} strokeWidth={1.5} />}
          <span className="text-[10px] font-semibold tracking-wider uppercase">{file.ext}</span>
        </div>
      ) : (
        <img
          src={thumbUrl(file.path, bucket, file.modified)}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className={cx(
            "max-h-full max-w-full object-contain transition-opacity duration-200",
            state === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      {file.kind === "video" && state !== "error" && (
        <span className="absolute bottom-1.5 left-1.5 flex h-5 items-center gap-1 rounded bg-black/65 px-1.5 text-[10px] font-semibold text-white backdrop-blur-sm">
          <Play size={9} fill="currentColor" strokeWidth={0} />
          {file.ext.toUpperCase()}
        </span>
      )}
    </div>
  );
});
