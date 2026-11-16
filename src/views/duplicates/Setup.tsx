// Scan options and the progress screen.
import { CopyCheck, FolderOpen, Play, ScanSearch, X } from "lucide-react";
import { Button, Segmented, Toggle } from "../../components/ui";
import { api } from "../../lib/api";
import { pickFolder } from "../../lib/dialogs";
import { basename } from "../../lib/formats";
import { useApp } from "../../store/app";
import { type Sensitivity, runScan, useDups } from "./store";

export function Setup() {
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

export function Row({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
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

export function Scanning() {
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
