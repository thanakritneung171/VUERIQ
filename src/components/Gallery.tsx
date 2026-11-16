import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCheck, FolderInput, FolderSearch, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { pickFolder } from "../lib/dialogs";
import { type GalleryLayout, bandHits, normRect, rangeIndices, toggled } from "../lib/selection";
import type { DirEntry, FileEntry } from "../lib/types";
import { isFavorite, plural, sortAndFilter } from "../lib/entries";
import { useApp } from "../store/app";
import { Button, IconButton } from "./ui";
import { ContextMenu } from "./gallery/ContextMenu";
import { type Item, GridCell, ListRow } from "./gallery/Cells";

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
