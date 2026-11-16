// One gallery item: a grid tile or a list row.
import { Folder, Star } from "lucide-react";
import { formatBytes, formatDate } from "../../lib/formats";
import type { DirEntry, FileEntry } from "../../lib/types";
import { Thumb } from "../Thumb";
import { cx } from "../ui";

export type Item = { type: "dir"; dir: DirEntry } | { type: "file"; file: FileEntry; fileIndex: number };

export interface CellProps {
  index: number;
  item: Item;
  selected: boolean;
  fav: boolean;
  missing: boolean;
  onClick: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onToggleFav: () => void;
  onContext: (x: number, y: number) => void;
}

export function GridCell({ index, item, width, selected, fav, missing, onClick, onOpen, onToggleFav, onContext }: CellProps & { width: number }) {
  const name = item.type === "dir" ? item.dir.name : item.file.name;
  return (
    <div
      role="button"
      tabIndex={-1}
      data-index={index}
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(e.clientX, e.clientY);
      }}
      className="group flex flex-col"
      style={{ width }}
      title={name}
    >
      <div
        className={cx(
          "relative overflow-hidden rounded-lg border transition-[border-color,box-shadow,background-color] duration-150",
          selected ? "border-accent bg-accent/10 shadow-[0_0_0_1px_var(--color-accent)]" : "border-line bg-panel group-hover:border-line-strong",
          missing && "opacity-40",
        )}
        style={{ height: width }}
      >
        {item.type === "dir" ? (
          <div className="flex h-full items-center justify-center text-fg-subtle">
            <Folder size={Math.round(width * 0.32)} strokeWidth={1.1} className="fill-fg/5" />
          </div>
        ) : (
          <>
            <Thumb file={item.file} size={width} className="h-full w-full p-1.5" />
            {selected && (
              <span className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-fg shadow">
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                  <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
            <button
              type="button"
              aria-label={fav ? "Remove from favorites" : "Add to favorites"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFav();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={cx(
                "absolute top-1.5 right-1.5 rounded-md bg-black/55 p-1 backdrop-blur-sm transition-opacity",
                fav ? "text-warn opacity-100" : "text-white/80 opacity-0 group-hover:opacity-100 hover:text-white",
              )}
            >
              <Star size={13} fill={fav ? "currentColor" : "none"} />
            </button>
          </>
        )}
      </div>
      <div className={cx("mt-1.5 truncate px-0.5 text-[12px]", selected ? "text-fg" : "text-fg-muted")}>
        {missing ? `${name} (missing)` : name}
      </div>
    </div>
  );
}

export function ListRow({ index, item, selected, fav, missing, onClick, onOpen, onToggleFav, onContext }: CellProps) {
  return (
    <div
      role="button"
      tabIndex={-1}
      data-index={index}
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(e.clientX, e.clientY);
      }}
      className={cx(
        "group grid h-10 grid-cols-[minmax(0,1fr)_120px_90px_170px_36px] items-center gap-3 rounded-md px-4 text-[13px]",
        selected ? "bg-accent/15 text-fg" : "text-fg-muted hover:bg-fg/5",
        missing && "opacity-45",
      )}
    >
      {item.type === "dir" ? (
        <>
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center text-fg-subtle">
              <Folder size={18} strokeWidth={1.5} />
            </span>
            <span className="truncate text-fg">{item.dir.name}</span>
          </span>
          <span>Folder</span>
          <span />
          <span />
          <span />
        </>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-3">
            <Thumb file={item.file} size={28} className="h-7 w-7 shrink-0 rounded bg-panel" />
            <span className="truncate text-fg">{item.file.name}</span>
          </span>
          <span className="uppercase">{item.file.ext} {item.file.kind === "video" ? "video" : "image"}</span>
          <span className="text-right tabular-nums">{item.file.size ? formatBytes(item.file.size) : "—"}</span>
          <span className="tabular-nums">{formatDate(item.file.modified)}</span>
          <button
            type="button"
            aria-label={fav ? "Remove from favorites" : "Add to favorites"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFav();
            }}
            className={cx("justify-self-center", fav ? "text-warn" : "text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg")}
          >
            <Star size={14} fill={fav ? "currentColor" : "none"} />
          </button>
        </>
      )}
    </div>
  );
}
