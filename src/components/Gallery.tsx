import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Folder,
  FolderSearch,
  LayoutGrid,
  List,
  Search,
  Star,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { formatBytes, formatDate } from "../lib/formats";
import type { DirEntry, FileEntry, KindFilter, SortKey } from "../lib/types";
import { isFavorite, sortAndFilter, useApp } from "../store/app";
import { Thumb } from "./Thumb";
import { IconButton, Menu, Segmented, cx } from "./ui";

type Item = { type: "dir"; dir: DirEntry } | { type: "file"; file: FileEntry; fileIndex: number };

const SORT_LABEL: Record<SortKey, string> = { name: "Name", date: "Date modified", size: "Size", type: "Type" };

export function GalleryToolbar({ count, total, leading }: { count: number; total: number; leading?: ReactNode }) {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const search = useApp((s) => s.search);
  const setSearch = useApp((s) => s.setSearch);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
      {leading}
      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files"
            spellCheck={false}
            className="h-8 w-48 rounded-md border border-line bg-panel pr-7 pl-8 text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent/60 focus:outline-none"
            onKeyDown={(e) => e.key === "Escape" && setSearch("")}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <Segmented<KindFilter>
          value={settings.kindFilter}
          onChange={(v) => update({ kindFilter: v })}
          options={[
            { value: "all", label: "All" },
            { value: "image", label: "Images" },
            { value: "video", label: "Videos" },
          ]}
        />
        <Menu
          align="right"
          trigger={(p) => (
            <button
              type="button"
              {...p}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-fg-muted hover:bg-fg/8 hover:text-fg"
              title="Sort"
            >
              {settings.sortDesc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
              {SORT_LABEL[settings.sortKey]}
            </button>
          )}
          items={[
            ...(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
              label: SORT_LABEL[k],
              checked: settings.sortKey === k,
              onSelect: () => update({ sortKey: k }),
            })),
            { label: "Ascending", checked: !settings.sortDesc, onSelect: () => update({ sortDesc: false }), separatorBefore: true },
            { label: "Descending", checked: settings.sortDesc, onSelect: () => update({ sortDesc: true }) },
          ]}
        />
        <div className="flex items-center">
          <IconButton label="Grid view" active={settings.viewMode === "grid"} onClick={() => update({ viewMode: "grid" })}>
            <LayoutGrid size={16} />
          </IconButton>
          <IconButton label="List view" active={settings.viewMode === "list"} onClick={() => update({ viewMode: "list" })}>
            <List size={16} />
          </IconButton>
        </div>
        {settings.viewMode === "grid" && (
          <input
            type="range"
            aria-label="Thumbnail size"
            title="Thumbnail size"
            min={112}
            max={320}
            step={8}
            value={settings.thumbnailSize}
            onChange={(e) => update({ thumbnailSize: Number(e.target.value) })}
            className="vq-range w-20"
            style={{ ["--vq-fill" as string]: `${((settings.thumbnailSize - 112) / 208) * 100}%` }}
          />
        )}
        <span className="w-20 text-right text-[12px] tabular-nums text-fg-subtle">
          {count === total ? `${total} items` : `${count} of ${total}`}
        </span>
      </div>
    </div>
  );
}

/**
 * Virtualized media gallery (grid or list). Handles thousands of entries: only visible rows are
 * mounted, so only visible thumbnails are requested from the backend.
 */
export function Gallery({
  files,
  dirs = [],
  onOpenDir,
  emptyState,
  missing,
  onRemove,
}: {
  files: FileEntry[];
  dirs?: DirEntry[];
  onOpenDir?: (path: string) => void;
  emptyState?: ReactNode;
  missing?: Set<string>;
  onRemove?: (path: string) => void;
}) {
  const settings = useApp((s) => s.settings);
  const search = useApp((s) => s.search);
  const favorites = useApp((s) => s.favorites);
  const toggleFavorite = useApp((s) => s.toggleFavorite);
  const openViewer = useApp((s) => s.openViewer);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [selected, setSelected] = useState(-1);
  const [ctx, setCtx] = useState<{ x: number; y: number; file: FileEntry } | null>(null);

  const visibleFiles = useMemo(
    () => sortAndFilter(files, settings.sortKey, settings.sortDesc, settings.kindFilter, search),
    [files, settings.sortKey, settings.sortDesc, settings.kindFilter, search],
  );
  const visibleDirs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? dirs.filter((d) => d.name.toLowerCase().includes(q)) : dirs;
  }, [dirs, search]);

  const items: Item[] = useMemo(
    () => [
      ...visibleDirs.map((dir) => ({ type: "dir" as const, dir })),
      ...visibleFiles.map((file, fileIndex) => ({ type: "file" as const, file, fileIndex })),
    ],
    [visibleDirs, visibleFiles],
  );

  useEffect(() => setSelected(-1), [files, dirs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const isGrid = settings.viewMode === "grid";
  const gap = 10;
  const pad = 16;
  const cell = settings.thumbnailSize;
  const cols = isGrid ? Math.max(1, Math.floor((width - pad * 2 + gap) / (cell + gap))) : 1;
  const cellW = isGrid ? Math.floor((width - pad * 2 - gap * (cols - 1)) / cols) : 0;
  const rowH = isGrid ? cellW + 34 + gap : 40;
  const rows = Math.ceil(items.length / cols);

  const virt = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 4,
    paddingStart: isGrid ? pad : 4,
    paddingEnd: pad,
  });

  useEffect(() => {
    virt.measure();
  }, [rowH, cols, virt]);

  const activate = (it: Item) => {
    if (it.type === "dir") onOpenDir?.(it.dir.path);
    else if (missing?.has(it.file.path)) return;
    else openViewer(visibleFiles.filter((f) => !missing?.has(f.path)), visibleFiles.filter((f) => !missing?.has(f.path)).indexOf(it.file));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    let n = selected;
    switch (e.key) {
      case "ArrowRight":
        n = Math.min(items.length - 1, selected + 1);
        break;
      case "ArrowLeft":
        n = Math.max(0, selected - 1);
        break;
      case "ArrowDown":
        n = Math.min(items.length - 1, selected < 0 ? 0 : selected + cols);
        break;
      case "ArrowUp":
        n = Math.max(0, selected - cols);
        break;
      case "Home":
        n = 0;
        break;
      case "End":
        n = items.length - 1;
        break;
      case "Enter":
        if (selected >= 0) activate(items[selected]);
        return;
      default:
        return;
    }
    e.preventDefault();
    setSelected(n);
    virt.scrollToIndex(Math.floor(n / cols), { align: "auto" });
  };

  if (!items.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        {emptyState ?? (
          <div className="flex flex-col items-center gap-3 text-center text-fg-muted">
            <FolderSearch size={36} strokeWidth={1.25} className="text-fg-subtle" />
            <div className="text-[14px] font-medium text-fg">{search ? "No matching files" : "No media in this folder"}</div>
            <div className="max-w-xs text-[12.5px]">
              {search ? "Try a different search term or filter." : "Supported images and videos will appear here."}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 overflow-y-auto focus:outline-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!isGrid && (
        <div className="sticky top-0 z-10 grid h-8 grid-cols-[minmax(0,1fr)_120px_90px_170px_36px] items-center gap-3 border-b border-line bg-bg/95 px-6 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase backdrop-blur">
          <span className="pl-10">Name</span>
          <span>Type</span>
          <span className="text-right">Size</span>
          <span>Modified</span>
          <span />
        </div>
      )}
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((row) => {
          const start = row.index * cols;
          const rowItems = items.slice(start, start + cols);
          return (
            <div
              key={row.key}
              className="absolute left-0 w-full"
              style={{ transform: `translateY(${row.start}px)`, height: rowH, paddingLeft: isGrid ? pad : 8, paddingRight: isGrid ? pad : 8 }}
            >
              {isGrid ? (
                <div className="flex" style={{ gap }}>
                  {rowItems.map((it, i) => (
                    <GridCell
                      key={it.type === "dir" ? it.dir.path : it.file.path}
                      item={it}
                      width={cellW}
                      selected={selected === start + i}
                      fav={it.type === "file" && isFavorite(favorites, it.file.path)}
                      missing={it.type === "file" && !!missing?.has(it.file.path)}
                      onClick={() => setSelected(start + i)}
                      onOpen={() => activate(it)}
                      onToggleFav={() => it.type === "file" && toggleFavorite(it.file.path)}
                      onContext={(x, y) => it.type === "file" && setCtx({ x, y, file: it.file })}
                    />
                  ))}
                </div>
              ) : (
                rowItems.map((it, i) => (
                  <ListRow
                    key={it.type === "dir" ? it.dir.path : it.file.path}
                    item={it}
                    selected={selected === start + i}
                    fav={it.type === "file" && isFavorite(favorites, it.file.path)}
                    missing={it.type === "file" && !!missing?.has(it.file.path)}
                    onClick={() => setSelected(start + i)}
                    onOpen={() => activate(it)}
                    onToggleFav={() => it.type === "file" && toggleFavorite(it.file.path)}
                    onContext={(x, y) => it.type === "file" && setCtx({ x, y, file: it.file })}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          items={[
            { label: "Open", onSelect: () => activate({ type: "file", file: ctx.file, fileIndex: 0 }) },
            {
              label: isFavorite(favorites, ctx.file.path) ? "Remove from Favorites" : "Add to Favorites",
              onSelect: () => toggleFavorite(ctx.file.path),
            },
            { label: "Show in Explorer", onSelect: () => api.revealInExplorer(ctx.file.path).catch(() => {}) },
            ...(onRemove ? [{ label: "Remove from list", onSelect: () => onRemove(ctx.file.path) }] : []),
          ]}
        />
      )}
    </div>
  );
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; onSelect: () => void }[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", close);
    };
  }, [onClose]);
  return (
    <div
      className="animate-pop-in fixed z-50 min-w-48 rounded-lg border border-line-strong bg-elev p-1 shadow-2xl shadow-black/40"
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - items.length * 32 - 12) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => {
            onClose();
            it.onSelect();
          }}
          className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px] text-fg hover:bg-fg/8"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

interface CellProps {
  item: Item;
  selected: boolean;
  fav: boolean;
  missing: boolean;
  onClick: () => void;
  onOpen: () => void;
  onToggleFav: () => void;
  onContext: (x: number, y: number) => void;
}

function GridCell({ item, width, selected, fav, missing, onClick, onOpen, onToggleFav, onContext }: CellProps & { width: number }) {
  const name = item.type === "dir" ? item.dir.name : item.file.name;
  return (
    <div
      role="button"
      tabIndex={-1}
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
          "relative overflow-hidden rounded-lg border bg-panel transition-[border-color,box-shadow] duration-150",
          selected ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-line group-hover:border-line-strong",
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

function ListRow({ item, selected, fav, missing, onClick, onOpen, onToggleFav, onContext }: CellProps) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(e.clientX, e.clientY);
      }}
      className={cx(
        "group grid h-10 grid-cols-[minmax(0,1fr)_120px_90px_170px_36px] items-center gap-3 rounded-md px-4 text-[13px]",
        selected ? "bg-accent/12 text-fg" : "text-fg-muted hover:bg-fg/5",
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
