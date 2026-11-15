import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CheckCheck,
  Folder,
  FolderInput,
  FolderSearch,
  LayoutGrid,
  List,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { pickFolder } from "../lib/dialogs";
import { formatBytes, formatDate } from "../lib/formats";
import { type GalleryLayout, bandHits, normRect, rangeIndices, toggled } from "../lib/selection";
import type { DirEntry, FileEntry, KindFilter, SortKey } from "../lib/types";
import { isFavorite, plural, sortAndFilter, useApp } from "../store/app";
import { Thumb } from "./Thumb";
import { Button, IconButton, Menu, Segmented, cx } from "./ui";

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
 *
 * Selection: click, Ctrl+click (toggle), Shift+click (range), drag a rectangle (rubber band,
 * hold Ctrl/Shift to add), Ctrl+A, arrow keys (+Shift). Delete / Move act on the selection.
 */
const NO_DIRS: DirEntry[] = [];

interface DragState {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  active: boolean;
  additive: boolean;
  base: Set<string>;
  onItem: boolean;
  raf: number;
}

export function Gallery({
  files,
  dirs = NO_DIRS,
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
  const deleteFiles = useApp((s) => s.deleteFiles);
  const moveFiles = useApp((s) => s.moveFiles);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [focus, setFocus] = useState(-1);
  const [anchor, setAnchor] = useState(-1);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; file: FileEntry; targets: string[] } | null>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

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

  // New folder → fresh selection. Files removed (delete / move) → keep what is still there.
  useEffect(() => {
    setFocus(-1);
    setAnchor(-1);
    setSel(new Set());
  }, [dirs]);
  useEffect(() => {
    setSel((prev) => {
      if (!prev.size) return prev;
      const present = new Set(files.map((f) => f.path));
      const next = new Set([...prev].filter((p) => present.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);
  useEffect(() => {
    setFocus((f) => Math.min(f, items.length - 1));
  }, [items.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [items.length > 0]);

  const isGrid = settings.viewMode === "grid";
  const gap = 10;
  const pad = 16;
  const cell = settings.thumbnailSize;
  const cols = isGrid ? Math.max(1, Math.floor((width - pad * 2 + gap) / (cell + gap))) : 1;
  const cellW = isGrid ? Math.floor((width - pad * 2 - gap * (cols - 1)) / cols) : 0;
  const rowH = isGrid ? cellW + 34 + gap : 40;
  const rows = Math.ceil(items.length / cols);
  const padTop = isGrid ? pad : 4;

  const virt = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 4,
    paddingStart: padTop,
    paddingEnd: pad,
  });

  useEffect(() => {
    virt.measure();
  }, [rowH, cols, virt]);

  const layout: GalleryLayout = {
    isGrid,
    count: items.length,
    cols,
    padTop,
    padLeft: isGrid ? pad : 8,
    rowH,
    cellW,
    gap,
    itemH: isGrid ? cellW + 34 : 40,
    width,
  };
  const live = useRef({ layout, items });
  live.current = { layout, items };

  const usable = (f: FileEntry) => !missing?.has(f.path);
  const selectedPaths = visibleFiles.filter((f) => sel.has(f.path) && usable(f)).map((f) => f.path);
  const filePathsAt = (idx: number[]) =>
    idx.flatMap((i) => {
      const it = live.current.items[i];
      return it?.type === "file" ? [it.file.path] : [];
    });

  const activate = (it: Item) => {
    if (it.type === "dir") onOpenDir?.(it.dir.path);
    else if (missing?.has(it.file.path)) return;
    else {
      const list = visibleFiles.filter(usable);
      openViewer(list, list.indexOf(it.file));
    }
  };

  const doDelete = (paths: string[]) => {
    if (paths.length) deleteFiles(paths);
  };
  const doMove = async (paths: string[]) => {
    if (!paths.length) return;
    const dest = await pickFolder(`Move ${plural(paths.length, "item")} to — VUERIQ`);
    if (dest) await moveFiles(paths, dest);
  };

  const selectIndex = (idx: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const it = items[idx];
    const ctrl = e.ctrlKey || e.metaKey;
    setFocus(idx);
    if (e.shiftKey && anchor >= 0) {
      const range = filePathsAt(rangeIndices(anchor, idx));
      setSel((prev) => (ctrl ? new Set([...prev, ...range]) : new Set(range)));
      return;
    }
    setAnchor(idx);
    if (it.type !== "file") {
      if (!ctrl) setSel(new Set());
    } else if (ctrl) setSel((prev) => toggled(prev, it.file.path));
    else setSel(new Set([it.file.path]));
  };

  // ── rubber-band selection ──
  const updateBand = () => {
    const d = drag.current;
    const c = contentRef.current;
    if (!d || !c) return;
    const cr = c.getBoundingClientRect();
    const x1 = Math.max(0, Math.min(cr.width, d.cx - cr.left));
    const y1 = Math.max(0, Math.min(cr.height, d.cy - cr.top));
    const r = normRect(d.x0, d.y0, x1, y1);
    setBand(r);
    const hits = filePathsAt(bandHits(r, live.current.layout));
    setSel(d.additive ? new Set([...d.base, ...hits]) : new Set(hits));
  };

  const autoScroll = () => {
    const d = drag.current;
    const el = scrollRef.current;
    if (!d?.active || !el) return;
    const r = el.getBoundingClientRect();
    const edge = 48;
    let dy = 0;
    if (d.cy < r.top + edge) dy = -Math.ceil((r.top + edge - d.cy) / 3);
    else if (d.cy > r.bottom - edge) dy = Math.ceil((d.cy - (r.bottom - edge)) / 3);
    if (dy) {
      el.scrollTop += dy;
      updateBand();
    }
    d.raf = requestAnimationFrame(autoScroll);
  };

  const onMouseMove = (e: MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    if (!d.active) {
      const c = contentRef.current!.getBoundingClientRect();
      if (Math.hypot(e.clientX - c.left - d.x0, e.clientY - c.top - d.y0) < 6) return;
      d.active = true;
      setCtx(null);
      d.raf = requestAnimationFrame(autoScroll);
    }
    updateBand();
  };

  const onMouseUp = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    if (d.active) {
      setBand(null);
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    } else if (!d.onItem && !d.additive) {
      setSel(new Set()); // click on empty space
    }
  };

  useEffect(
    () => () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    },
    [],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    const c = contentRef.current;
    if (!el || !c) return;
    if (e.clientX >= el.getBoundingClientRect().left + el.clientWidth) return; // scrollbar
    const target = e.target as Element;
    if (target.closest("button, input, a")) return;
    const cr = c.getBoundingClientRect();
    drag.current = {
      x0: e.clientX - cr.left,
      y0: e.clientY - cr.top,
      cx: e.clientX,
      cy: e.clientY,
      active: false,
      additive: e.ctrlKey || e.metaKey || e.shiftKey,
      base: new Set(sel),
      onItem: !!target.closest("[data-index]"),
      raf: 0,
    };
    e.preventDefault(); // no text selection / native drag
    el.focus({ preventScroll: true });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      setSel(new Set(visibleFiles.filter(usable).map((f) => f.path)));
      return;
    }
    if (e.key === "Escape" && sel.size) {
      e.preventDefault();
      e.stopPropagation();
      setSel(new Set());
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      doDelete(selectedPaths);
      return;
    }
    let n = focus;
    switch (e.key) {
      case "ArrowRight":
        n = Math.min(items.length - 1, focus + 1);
        break;
      case "ArrowLeft":
        n = Math.max(0, focus - 1);
        break;
      case "ArrowDown":
        n = Math.min(items.length - 1, focus < 0 ? 0 : focus + cols);
        break;
      case "ArrowUp":
        n = Math.max(0, focus - cols);
        break;
      case "Home":
        n = 0;
        break;
      case "End":
        n = items.length - 1;
        break;
      case "Enter":
        if (focus >= 0) activate(items[focus]);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (e.shiftKey && anchor >= 0) {
      setFocus(n);
      setSel(new Set(filePathsAt(rangeIndices(anchor, n))));
    } else selectIndex(n, { ctrlKey: false, metaKey: false, shiftKey: false });
    virt.scrollToIndex(Math.floor(n / cols), { align: "auto" });
  };

  const openContext = (idx: number, x: number, y: number) => {
    const it = items[idx];
    if (it.type !== "file") return;
    let targets = selectedPaths;
    if (!sel.has(it.file.path)) {
      setSel(new Set([it.file.path]));
      setFocus(idx);
      setAnchor(idx);
      targets = [it.file.path];
    }
    setCtx({ x, y, file: it.file, targets: targets.filter((p) => !missing?.has(p)) });
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

  const isSelected = (it: Item, idx: number) => (it.type === "file" ? sel.has(it.file.path) : focus === idx);
  const nSel = selectedPaths.length;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        className="relative min-h-0 flex-1 overflow-y-auto select-none focus:outline-none"
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
        <div ref={contentRef} style={{ height: virt.getTotalSize(), position: "relative" }}>
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
                        index={start + i}
                        item={it}
                        width={cellW}
                        selected={isSelected(it, start + i)}
                        fav={it.type === "file" && isFavorite(favorites, it.file.path)}
                        missing={it.type === "file" && !!missing?.has(it.file.path)}
                        onClick={(e) => !suppressClick.current && selectIndex(start + i, e)}
                        onOpen={() => activate(it)}
                        onToggleFav={() => it.type === "file" && toggleFavorite(it.file.path)}
                        onContext={(x, y) => openContext(start + i, x, y)}
                      />
                    ))}
                  </div>
                ) : (
                  rowItems.map((it, i) => (
                    <ListRow
                      key={it.type === "dir" ? it.dir.path : it.file.path}
                      index={start + i}
                      item={it}
                      selected={isSelected(it, start + i)}
                      fav={it.type === "file" && isFavorite(favorites, it.file.path)}
                      missing={it.type === "file" && !!missing?.has(it.file.path)}
                      onClick={(e) => !suppressClick.current && selectIndex(start + i, e)}
                      onOpen={() => activate(it)}
                      onToggleFav={() => it.type === "file" && toggleFavorite(it.file.path)}
                      onContext={(x, y) => openContext(start + i, x, y)}
                    />
                  ))
                )}
              </div>
            );
          })}
          {band && (
            <div
              className="pointer-events-none absolute z-20 rounded-[3px] border border-accent bg-accent/15"
              style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
            />
          )}
        </div>
        {ctx && (
          <ContextMenu
            x={ctx.x}
            y={ctx.y}
            onClose={() => setCtx(null)}
            items={[
              ...(ctx.targets.length <= 1
                ? [
                    { label: "Open", onSelect: () => activate({ type: "file", file: ctx.file, fileIndex: 0 }) },
                    {
                      label: isFavorite(favorites, ctx.file.path) ? "Remove from Favorites" : "Add to Favorites",
                      onSelect: () => toggleFavorite(ctx.file.path),
                    },
                    { label: "Show in Explorer", onSelect: () => api.revealInExplorer(ctx.file.path).catch(() => {}) },
                  ]
                : []),
              ...(ctx.targets.length
                ? [
                    {
                      label: ctx.targets.length > 1 ? `Move ${ctx.targets.length} items to…` : "Move to…",
                      onSelect: () => doMove(ctx.targets),
                      separatorBefore: ctx.targets.length <= 1,
                    },
                    {
                      label: ctx.targets.length > 1 ? `Delete ${ctx.targets.length} items` : "Delete",
                      hint: "Del",
                      danger: true,
                      onSelect: () => doDelete(ctx.targets),
                    },
                  ]
                : []),
              ...(onRemove && ctx.targets.length <= 1
                ? [{ label: "Remove from list", onSelect: () => onRemove(ctx.file.path), separatorBefore: true }]
                : []),
            ]}
          />
        )}
      </div>

      {nSel > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
          <div
            role="toolbar"
            aria-label="Selection"
            className="animate-pop-in pointer-events-auto flex items-center gap-1 rounded-xl border border-line-strong bg-elev/95 p-1.5 pl-4 shadow-2xl shadow-black/40 backdrop-blur"
          >
            <span className="mr-2 text-[13px] font-medium tabular-nums">{plural(nSel, "item")} selected</span>
            <Button variant="ghost" icon={<CheckCheck size={15} />} onClick={() => setSel(new Set(visibleFiles.filter(usable).map((f) => f.path)))} title="Select all (Ctrl+A)">
              All
            </Button>
            <Button variant="ghost" icon={<FolderInput size={15} />} onClick={() => doMove(selectedPaths)}>
              Move to…
            </Button>
            <Button variant="ghost" icon={<Trash2 size={15} />} className="text-danger hover:text-danger" onClick={() => doDelete(selectedPaths)} title="Move to the Recycle Bin (Del)">
              Delete
            </Button>
            <span className="mx-1 h-5 w-px bg-line" />
            <IconButton label="Clear selection" shortcut="Esc" onClick={() => setSel(new Set())}>
              <X size={16} />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}

interface CtxItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hint?: string;
  separatorBefore?: boolean;
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: CtxItem[]; onClose: () => void }) {
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
      className="animate-pop-in fixed z-50 min-w-52 rounded-lg border border-line-strong bg-elev p-1 shadow-2xl shadow-black/40"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - items.length * 34 - 16) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <div key={it.label}>
          {it.separatorBefore && <div className="mx-1 my-1 h-px bg-line" />}
          <button
            type="button"
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cx(
              "flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px] hover:bg-fg/8",
              it.danger ? "text-danger" : "text-fg",
            )}
          >
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-[11px] text-fg-subtle">{it.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}

interface CellProps {
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

function GridCell({ index, item, width, selected, fav, missing, onClick, onOpen, onToggleFav, onContext }: CellProps & { width: number }) {
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

function ListRow({ index, item, selected, fav, missing, onClick, onOpen, onToggleFav, onContext }: CellProps) {
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
