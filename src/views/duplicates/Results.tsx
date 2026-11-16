// Groups of duplicates with selection, auto-select rules and bulk delete / move.
import { Check, CheckCheck, CopyCheck, Eye, FolderInput, ListChecks, RefreshCw, Square, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Thumb } from "../../components/Thumb";
import { Button, Menu, cx } from "../../components/ui";
import { api } from "../../lib/api";
import { pickFolder } from "../../lib/dialogs";
import { type KeepRule, autoSelect, fullySelected, selectedBytes, visibleGroups } from "../../lib/duplicates";
import { basename, formatBytes, formatDate } from "../../lib/formats";
import type { DupFile, DupGroup, DupReport } from "../../lib/types";
import { plural } from "../../lib/entries";
import { useApp } from "../../store/app";
import { RULE_LABEL, relFolder, runScan, useDups } from "./store";
import { Preview } from "./Preview";

export function Results({ report }: { report: DupReport }) {
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


export function GroupCard({
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

export function Tile({ file, folder, selected, onToggle, onOpen }: { file: DupFile; folder: string | null; selected: boolean; onToggle: () => void; onOpen: () => void }) {
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
