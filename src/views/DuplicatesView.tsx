import { listen } from "@tauri-apps/api/event";
import {
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CopyCheck,
  Eye,
  FolderInput,
  FolderOpen,
  ListChecks,
  Maximize2,
  Play,
  RefreshCw,
  ScanSearch,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImageView } from "../components/ImageView";
import { create } from "zustand";
import { Thumb } from "../components/Thumb";
import { Button, IconButton, Menu, Segmented, Toggle, cx } from "../components/ui";
import { api, isTauri, thumbUrl } from "../lib/api";
import { pickFolder } from "../lib/dialogs";
import { type KeepRule, autoSelect, fullySelected, selectedBytes, visibleGroups } from "../lib/duplicates";
import { basename, formatBytes, formatDate } from "../lib/formats";
import type { ApiError, DupFile, DupGroup, DupProgress, DupReport, ImageInfo } from "../lib/types";
import { plural, useApp } from "../store/app";

type Sensitivity = "strict" | "normal" | "loose";
const THRESHOLD: Record<Sensitivity, number> = { strict: 5, normal: 8, loose: 12 };
const RULE_LABEL: Record<KeepRule, string> = {
  largest: "Keep the highest quality",
  oldest: "Keep the oldest",
  newest: "Keep the newest",
};

interface DupStore {
  report: DupReport | null;
  scanning: boolean;
  progress: DupProgress | null;
  sel: Set<string>;
  gone: Set<string>;
  recursive: boolean;
  similar: boolean;
  sensitivity: Sensitivity;
  rule: KeepRule;
  /** Results scroll position, restored when coming back from the full viewer. */
  scrollTop: number;
  set: (p: Partial<DupStore>) => void;
}

// Own store: results survive opening the viewer or visiting another section.
const useDups = create<DupStore>((set) => ({
  report: null,
  scanning: false,
  progress: null,
  sel: new Set(),
  gone: new Set(),
  recursive: true,
  similar: true,
  sensitivity: "normal",
  rule: "largest",
  scrollTop: 0,
  set: (p) => set(p),
}));

async function runScan(folder: string) {
  const s = useDups.getState();
  s.set({ scanning: true, progress: { phase: "listing", done: 0, total: 0 }, report: null, sel: new Set(), gone: new Set(), scrollTop: 0 });
  let un: (() => void) | undefined;
  if (isTauri) un = await listen<DupProgress>("dup-progress", (e) => useDups.setState({ progress: e.payload }));
  try {
    const report = await api.findDuplicates(folder, { recursive: s.recursive, similar: s.similar, threshold: THRESHOLD[s.sensitivity] });
    if (report.cancelled) useDups.setState({ report: null });
    else useDups.setState({ report, sel: autoSelect(report.groups, useDups.getState().rule) });
  } catch (e) {
    useApp.getState().showToast((e as ApiError).message, "error");
  } finally {
    un?.();
    useDups.setState({ scanning: false, progress: null });
  }
}

export function DuplicatesView() {
  const report = useDups((s) => s.report);
  const scanning = useDups((s) => s.scanning);
  if (scanning) return <Scanning />;
  return report ? <Results report={report} /> : <Setup />;
}

function Setup() {
  const folder = useApp((s) => s.folder);
  const { recursive, similar, sensitivity, set } = useDups();
  const choose = async () => {
    const p = await pickFolder("Find duplicates — choose a folder");
    if (p) runScan(p);
  };
  const name = folder ? basename(folder.path.replace(/[\\/]+$/, "")) || folder.path : null;
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto bg-bg p-8">
      <div className="w-full max-w-[520px]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
            <CopyCheck size={22} />
          </span>
          <div>
            <h1 className="font-display text-[22px] font-semibold tracking-tight">Find Duplicates</h1>
            <p className="text-[13px] text-fg-muted">Find copies of the same photo or video and free up space.</p>
          </div>
        </div>

        <div className="mt-6 divide-y divide-line rounded-xl border border-line bg-panel">
          <Row title="Include subfolders" sub="Also look inside every folder below the one you pick.">
            <Toggle checked={recursive} onChange={(v) => set({ recursive: v })} label="Include subfolders" />
          </Row>
          <Row title="Find similar photos" sub="Same picture saved again, resized, compressed or converted (e.g. HEIC and JPG). Exact copies are always found.">
            <Toggle checked={similar} onChange={(v) => set({ similar: v })} label="Find similar photos" />
          </Row>
          {similar && (
            <Row title="How similar" sub="Strict finds only near-identical copies; Loose also catches heavier edits.">
              <Segmented<Sensitivity>
                value={sensitivity}
                onChange={(v) => set({ sensitivity: v })}
                options={[
                  { value: "strict", label: "Strict" },
                  { value: "normal", label: "Normal" },
                  { value: "loose", label: "Loose" },
                ]}
              />
            </Row>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {folder && (
            <Button variant="primary" className="h-10 justify-start px-4" icon={<Play size={15} />} onClick={() => runScan(folder.path)}>
              <span className="truncate">Scan “{name}”</span>
            </Button>
          )}
          <Button variant={folder ? "secondary" : "primary"} className="h-10 justify-start px-4" icon={<FolderOpen size={15} />} onClick={choose}>
            Choose a folder…
          </Button>
        </div>
        <p className="mt-4 text-[12px] text-fg-subtle">Nothing is deleted until you choose to. Deleted files go to the Recycle Bin and can be restored with Undo.</p>
      </div>
    </div>
  );
}

function Row({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 p-4">
      <div>
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12px] text-fg-subtle">{sub}</div>
      </div>
      {children}
    </div>
  );
}

function Scanning() {
  const p = useDups((s) => s.progress);
  const label =
    p?.phase === "analyzing" ? "Comparing what photos look like" : p?.phase === "comparing" ? "Comparing file contents" : "Looking for media files";
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : null;
  return (
    <div className="flex flex-1 items-center justify-center bg-bg p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <ScanSearch size={34} strokeWidth={1.4} className="text-accent" />
        <div className="text-[15px] font-medium">{label}…</div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          {pct === null ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60" />
          ) : (
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
          )}
        </div>
        <div className="text-[12px] tabular-nums text-fg-subtle">{p && p.total ? `${p.done.toLocaleString()} / ${p.total.toLocaleString()}` : " "}</div>
        <Button variant="ghost" icon={<X size={15} />} onClick={() => api.cancelDuplicates()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Results({ report }: { report: DupReport }) {
  const { sel, gone, rule, set } = useDups();
  const fsVersion = useApp((s) => s.fsVersion);
  const deleteFiles = useApp((s) => s.deleteFiles);
  const moveFiles = useApp((s) => s.moveFiles);
  const askConfirm = useApp((s) => s.askConfirm);
  const openViewer = useApp((s) => s.openViewer);

  // Re-check which files still exist after any delete / move / undo.
  useEffect(() => {
    const all = report.groups.flatMap((g) => g.files.map((f) => f.path));
    let alive = true;
    api
      .pathExists(all)
      .then((ex) => {
        if (!alive) return;
        const g = new Set(all.filter((_, i) => !ex[i]));
        const s = useDups.getState().sel;
        useDups.setState({ gone: g, sel: new Set([...s].filter((p) => !g.has(p))) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [report, fsVersion]);

  const groups = useMemo(() => visibleGroups(report.groups, gone), [report, gone]);
  const selected = useMemo(() => groups.flatMap((g) => g.files.filter((f) => sel.has(f.path)).map((f) => f.path)), [groups, sel]);
  const bytes = selectedBytes(groups, sel);
  const reclaimable = groups.reduce((s, g) => s + g.reclaimable, 0);
  const dupFiles = groups.reduce((s, g) => s + g.files.length - 1, 0);

  const toggle = (p: string) =>
    useDups.setState((s) => {
      const n = new Set(s.sel);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return { sel: n };
    });
  const setMany = (paths: string[], on: boolean) =>
    useDups.setState((s) => {
      const n = new Set(s.sel);
      for (const p of paths) {
        if (on) n.add(p);
        else n.delete(p);
      }
      return { sel: n };
    });
  const allPaths = useMemo(() => groups.flatMap((g) => g.files.map((f) => f.path)), [groups]);

  const [preview, setPreview] = useState<{ files: DupFile[]; index: number } | null>(null);

  // Keep the scroll position across a trip to the full viewer (this view unmounts meanwhile).
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = useDups.getState().scrollTop;
  }, [groups.length > 0]);

  const del = async () => {
    if (!selected.length) return;
    const full = fullySelected(groups, sel);
    if (
      full.length &&
      !(await askConfirm({
        title: "Delete every copy?",
        message: `In ${plural(full.length, "group")} you selected all copies, so no version of ${full.length === 1 ? "that photo" : "those photos"} would be left. Delete anyway?`,
        confirmLabel: "Delete all copies",
        danger: true,
      }))
    )
      return;
    await deleteFiles(selected);
  };
  const move = async () => {
    if (!selected.length) return;
    const dest = await pickFolder(`Move ${plural(selected.length, "item")} to — VUERIQ`);
    if (dest) await moveFiles(selected, dest);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <CopyCheck size={16} className="text-fg-subtle" />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold" title={report.root}>
            {basename(report.root.replace(/[\\/]+$/, "")) || report.root}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" className="h-8 px-2.5 text-[12.5px]" icon={<RefreshCw size={14} />} onClick={() => runScan(report.root)}>
            Scan again
          </Button>
          <Button variant="ghost" className="h-8 px-2.5 text-[12.5px]" onClick={() => set({ report: null })}>
            New scan
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <Check size={36} strokeWidth={1.4} className="text-ok" />
          <div className="text-[15px] font-medium">No duplicates found</div>
          <div className="text-[12.5px] text-fg-muted">
            Checked {plural(report.scanned, "file")} in {(report.elapsedMs / 1000).toFixed(1)} s.
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5 text-[12.5px]">
            <span className="text-fg-muted">
              <b className="font-semibold text-fg">{plural(groups.length, "group")}</b> · {`${dupFiles} extra ${dupFiles === 1 ? "copy" : "copies"}`} · up to{" "}
              <b className="font-semibold text-fg">{formatBytes(reclaimable)}</b> can be freed · checked {plural(report.scanned, "file")} in{" "}
              {(report.elapsedMs / 1000).toFixed(1)} s
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Menu
                align="right"
                trigger={(p) => (
                  <Button {...p} variant="ghost" className="h-8 px-2.5 text-[12.5px]" icon={<ListChecks size={15} />}>
                    Auto-select
                  </Button>
                )}
                items={[
                  ...(Object.keys(RULE_LABEL) as KeepRule[]).map((r) => ({
                    label: RULE_LABEL[r],
                    checked: rule === r,
                    onSelect: () => set({ rule: r, sel: autoSelect(groups, r) }),
                  })),
                ]}
              />
              <Button variant="ghost" className="h-8 px-2.5 text-[12.5px]" icon={<CheckCheck size={15} />} onClick={() => set({ sel: new Set(allPaths) })}>
                Select all
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-2.5 text-[12.5px]"
                icon={<Square size={14} />}
                disabled={!selected.length}
                onClick={() => set({ sel: new Set() })}
              >
                Unselect all
              </Button>
              <Button variant="secondary" className="h-8" icon={<FolderInput size={15} />} disabled={!selected.length} onClick={move}>
                Move…
              </Button>
              <Button variant="danger" className="h-8" icon={<Trash2 size={15} />} disabled={!selected.length} onClick={del}>
                Delete {selected.length ? `${selected.length} · ${formatBytes(bytes)}` : ""}
              </Button>
            </div>
          </div>

          <div
            ref={scrollRef}
            onScroll={(e) => useDups.setState({ scrollTop: e.currentTarget.scrollTop })}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
          >
            {groups.map((g) => (
              <GroupCard
                key={g.files.map((f) => f.path).join("|")}
                group={g}
                root={report.root}
                sel={sel}
                onToggle={toggle}
                onSetAll={(on) => setMany(g.files.map((f) => f.path), on)}
                onOpen={(i) => setPreview({ files: g.files, index: i })}
              />
            ))}
          </div>
        </>
      )}

      {preview && (
        <Preview
          files={preview.files}
          index={preview.index}
          sel={sel}
          root={report.root}
          onIndex={(i) => setPreview({ ...preview, index: i })}
          onToggle={toggle}
          onClose={() => setPreview(null)}
          onOpenViewer={() => openViewer(preview.files, preview.index)}
        />
      )}
    </div>
  );
}

function relFolder(root: string, path: string) {
  const dir = path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
  const r = root.replace(/[\\/]+$/, "");
  if (dir.toLowerCase() === r.toLowerCase()) return null;
  return dir.toLowerCase().startsWith(r.toLowerCase()) ? dir.slice(r.length + 1) : dir;
}

function GroupCard({
  group,
  root,
  sel,
  onToggle,
  onSetAll,
  onOpen,
}: {
  group: DupGroup;
  root: string;
  sel: Set<string>;
  onToggle: (p: string) => void;
  onSetAll: (on: boolean) => void;
  onOpen: (i: number) => void;
}) {
  const allSelected = group.files.every((f) => sel.has(f.path));
  const noneSelected = !group.files.some((f) => sel.has(f.path));
  return (
    <div className="rounded-xl border border-line bg-panel p-3" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 270px" }}>
      <div className="mb-2.5 flex items-center gap-2 px-1 text-[12px]">
        <span
          className={cx(
            "rounded px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase",
            group.kind === "exact" ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn",
          )}
          title={group.kind === "exact" ? "Byte-for-byte identical files" : "Different files that show the same picture"}
        >
          {group.kind === "exact" ? "Identical" : "Similar"}
        </span>
        <span className="text-fg-muted">{plural(group.files.length, "file")}</span>
        <span className="text-fg-subtle">· {formatBytes(group.reclaimable)} reclaimable</span>
        <span className="ml-auto flex items-center gap-2">
          {allSelected && <span className="text-danger">All copies selected</span>}
          <button
            type="button"
            disabled={allSelected}
            onClick={() => onSetAll(true)}
            className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-fg/8 hover:text-fg disabled:pointer-events-none disabled:opacity-35"
          >
            Select all
          </button>
          <button
            type="button"
            disabled={noneSelected}
            onClick={() => onSetAll(false)}
            className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-fg/8 hover:text-fg disabled:pointer-events-none disabled:opacity-35"
          >
            Unselect all
          </button>
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {group.files.map((f, i) => (
          <Tile key={f.path} file={f} folder={relFolder(root, f.path)} selected={sel.has(f.path)} onToggle={() => onToggle(f.path)} onOpen={() => onOpen(i)} />
        ))}
      </div>
    </div>
  );
}

function Tile({ file, folder, selected, onToggle, onOpen }: { file: DupFile; folder: string | null; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <div className="w-[168px] shrink-0">
      <div
        role="checkbox"
        aria-checked={selected}
        aria-label={`${file.name}${selected ? " (selected for removal)" : " (kept)"}`}
        tabIndex={0}
        onClick={onToggle}
        onDoubleClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            onToggle();
          } else if (e.key === "Enter") onOpen();
        }}
        title="Click to select · double-click to preview"
        className={cx(
          "group/tile relative h-[168px] cursor-pointer overflow-hidden rounded-lg border bg-bg transition-[border-color,opacity] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          selected ? "border-danger/70" : "border-line hover:border-line-strong",
        )}
      >
        <Thumb file={file} size={168} className={cx("h-full w-full p-1.5 transition-opacity", selected && "opacity-55")} />
        <span
          className={cx(
            "absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-md border shadow",
            selected ? "border-danger bg-danger text-white" : "border-white/70 bg-black/40",
          )}
        >
          {selected && <Trash2 size={11} strokeWidth={2.5} />}
        </span>
        <button
          type="button"
          aria-label={`Preview ${file.name}`}
          title="Preview"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white opacity-0 shadow backdrop-blur-sm transition-opacity group-hover/tile:opacity-100 hover:bg-black/75"
        >
          <Eye size={13} />
        </button>
        {!selected && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-ok/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">KEEP</span>
        )}
      </div>
      <div className="mt-1.5 truncate text-[12px] font-medium" title={file.path}>
        {file.name}
      </div>
      <div className="truncate text-[11px] text-fg-subtle tabular-nums">
        {file.width && file.height ? `${file.width}×${file.height} · ` : ""}
        {formatBytes(file.size)}
      </div>
      <div className="truncate text-[11px] text-fg-subtle tabular-nums">{formatDate(file.modified)}</div>
      {folder && (
        <div className="truncate text-[11px] text-fg-subtle" title={folder}>
          in {folder}
        </div>
      )}
    </div>
  );
}

/** In-place preview over the results, so closing it returns exactly where you were. */
function Preview({
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

function PreviewEdge({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
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
