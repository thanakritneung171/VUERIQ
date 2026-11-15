import { Check, FolderOpen, GalleryHorizontalEnd, ImageOff, PartyPopper, Play, Undo2, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Button, Kbd, Spinner, Toggle, cx } from "../components/ui";
import { api, thumbUrl } from "../lib/api";
import { pickFolder } from "../lib/dialogs";
import { basename, formatBytes, formatDate } from "../lib/formats";
import { type SwipeDecision, swipeOutcome } from "../lib/selection";
import type { ApiError, FileEntry } from "../lib/types";
import { plural, sortAndFilter, useApp } from "../store/app";

// ───────────────────────── session state ─────────────────────────
// Kept in its own store so a session survives switching to another section and back.

type Status = "kept" | "pending" | "recycled" | "permanent" | "failed";

interface HistoryItem {
  file: FileEntry;
  action: SwipeDecision;
  status: Status;
  pending?: Promise<void>;
}

interface Session {
  folder: string;
  label: string;
  queue: FileEntry[];
  /** Deleting on this drive is permanent (no Recycle Bin) — confirmed once at start. */
  permanent: boolean;
}

interface SwipeStore {
  session: Session | null;
  index: number;
  history: HistoryItem[];
  includeVideos: boolean;
  set: (p: Partial<SwipeStore>) => void;
}

const useSwipe = create<SwipeStore>((set) => ({
  session: null,
  index: 0,
  history: [],
  includeVideos: false,
  set: (p) => set(p),
}));

const PREVIEW = 1024;
const FLY_MS = 240;

// ───────────────────────── view ─────────────────────────

export function SwipeView() {
  const session = useSwipe((s) => s.session);
  return session ? <Review session={session} /> : <Setup />;
}

function Setup() {
  const folder = useApp((s) => s.folder);
  const settings = useApp((s) => s.settings);
  const askConfirm = useApp((s) => s.askConfirm);
  const showToast = useApp((s) => s.showToast);
  const includeVideos = useSwipe((s) => s.includeVideos);
  const setSwipe = useSwipe((s) => s.set);
  const [loading, setLoading] = useState(false);

  const count = (files: FileEntry[]) => files.filter((f) => includeVideos || f.kind === "image").length;

  const start = async (path: string, files?: FileEntry[]) => {
    setLoading(true);
    try {
      const list = files ?? (await api.listFolder(path)).files;
      const queue = sortAndFilter(list, settings.sortKey, settings.sortDesc, includeVideos ? "all" : "image", "");
      if (!queue.length) {
        showToast(includeVideos ? "This folder has no images or videos." : "This folder has no images.", "error");
        return;
      }
      const permanent = !(await api.hasRecycleBin(path).catch(() => true));
      if (
        permanent &&
        !(await askConfirm({
          title: "No Recycle Bin on this drive",
          message: "This folder is on a removable or network drive. Photos you swipe left will be deleted permanently and can't be restored with Undo.",
          confirmLabel: "Start anyway",
          danger: true,
        }))
      )
        return;
      setSwipe({ session: { folder: path, label: basename(path.replace(/[\\/]+$/, "")) || path, queue, permanent }, index: 0, history: [] });
    } catch (e) {
      showToast((e as ApiError).message, "error");
    } finally {
      setLoading(false);
    }
  };

  const choose = async () => {
    const p = await pickFolder("Swipe Sort — choose a folder");
    if (p) start(p);
  };

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto bg-bg p-8">
      <div className="w-full max-w-[520px]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
            <GalleryHorizontalEnd size={22} />
          </span>
          <div>
            <h1 className="font-display text-[22px] font-semibold tracking-tight">Swipe Sort</h1>
            <p className="text-[13px] text-fg-muted">Go through a folder one photo at a time.</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ok">
              <Check size={16} /> Swipe right
            </div>
            <div className="mt-1 text-[12.5px] text-fg-muted">Keep the photo where it is.</div>
          </div>
          <div className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-danger">
              <X size={16} /> Swipe left
            </div>
            <div className="mt-1 text-[12.5px] text-fg-muted">Move it to the Recycle Bin.</div>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] text-fg-subtle">
          Drag the photo with the mouse or a finger, use the buttons, or press <Kbd>←</Kbd> / <Kbd>→</Kbd>. Made a mistake?{" "}
          <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> or the Undo button brings it back.
        </p>

        <div className="mt-6 flex items-center justify-between rounded-xl border border-line bg-panel p-4">
          <div>
            <div className="text-[13px] font-medium">Include videos</div>
            <div className="text-[12px] text-fg-subtle">Sort videos together with photos.</div>
          </div>
          <Toggle checked={includeVideos} onChange={(v) => setSwipe({ includeVideos: v })} label="Include videos" />
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {folder && count(folder.files) > 0 && (
            <Button variant="primary" className="h-10 justify-start px-4" icon={<Play size={15} />} disabled={loading} onClick={() => start(folder.path, folder.files)}>
              <span className="truncate">
                Start with “{basename(folder.path.replace(/[\\/]+$/, "")) || folder.path}” · {plural(count(folder.files), includeVideos ? "item" : "photo")}
              </span>
            </Button>
          )}
          <Button
            variant={folder && count(folder.files) > 0 ? "secondary" : "primary"}
            className="h-10 justify-start px-4"
            icon={loading ? <Spinner size={15} /> : <FolderOpen size={15} />}
            disabled={loading}
            onClick={choose}
          >
            Choose a folder…
          </Button>
        </div>
      </div>
    </div>
  );
}

function Review({ session }: { session: Session }) {
  const index = useSwipe((s) => s.index);
  const history = useSwipe((s) => s.history);
  const setSwipe = useSwipe((s) => s.set);
  const deleteFiles = useApp((s) => s.deleteFiles);
  const restoreFiles = useApp((s) => s.restoreFiles);
  const showToast = useApp((s) => s.showToast);
  const openFolder = useApp((s) => s.openFolder);
  const cardRef = useRef<SwipeCardHandle>(null);
  const [enterFrom, setEnterFrom] = useState<"left" | "right" | null>(null);
  const [nonce, setNonce] = useState(0);
  const [undoing, setUndoing] = useState(false);

  const { queue } = session;
  const file = queue[index];
  const done = index >= queue.length;
  const kept = history.filter((h) => h.status === "kept").length;
  const deleted = history.filter((h) => h.status === "recycled" || h.status === "permanent" || h.status === "pending").length;

  // Warm the thumbnail cache for the next few cards.
  useEffect(() => {
    for (const f of queue.slice(index + 1, index + 4)) new Image().src = thumbUrl(f.path, PREVIEW, f.modified);
  }, [index, queue]);

  const decide = useCallback(
    (d: SwipeDecision) => {
      const st = useSwipe.getState();
      const f = session.queue[st.index];
      if (!f) return;
      const item: HistoryItem = { file: f, action: d, status: d === "keep" ? "kept" : "pending" };
      if (d === "delete") {
        item.pending = deleteFiles([f.path], { quiet: true, allowPermanent: session.permanent }).then((out) => {
          item.status = out.recycled.length ? "recycled" : out.deleted.length ? "permanent" : "failed";
          item.pending = undefined;
          if (item.status === "failed") {
            showToast(`Couldn't delete ${f.name}: ${out.failed[0]?.error ?? "unknown error"} — kept instead.`, "error");
          }
          useSwipe.setState({ history: [...useSwipe.getState().history] });
        });
      }
      setEnterFrom(null);
      st.set({ history: [...st.history, item], index: st.index + 1 });
    },
    [session, deleteFiles, showToast],
  );

  const undo = useCallback(async () => {
    const st = useSwipe.getState();
    const last = st.history[st.history.length - 1];
    if (!last || undoing) return;
    setUndoing(true);
    try {
      if (last.pending) await last.pending;
      if (last.status === "recycled") {
        const restored = await restoreFiles([last.file.path]);
        if (!restored.length) return; // error already shown; keep history as is
      } else if (last.status === "permanent") {
        showToast(`${last.file.name} was deleted permanently and can't be restored.`, "error");
      }
      const cur = useSwipe.getState();
      cur.set({ history: cur.history.slice(0, -1), index: Math.max(0, cur.index - 1) });
      setEnterFrom(last.action === "keep" ? "right" : "left");
      setNonce((n) => n + 1);
    } finally {
      setUndoing(false);
    }
  }, [undoing, restoreFiles, showToast]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const app = useApp.getState();
      if (app.confirm || app.viewer) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, [role=menu]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if ((ctrl && (e.key === "z" || e.key === "Z")) || (!ctrl && e.key === "Backspace")) {
        e.preventDefault();
        undo();
      } else if (!ctrl && (e.key === "ArrowLeft" || e.key === "Delete")) {
        e.preventDefault();
        cardRef.current?.fling("left");
      } else if (!ctrl && e.key === "ArrowRight") {
        e.preventDefault();
        cardRef.current?.fling("right");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const end = () => setSwipe({ session: null, index: 0, history: [] });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      {/* header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <GalleryHorizontalEnd size={16} className="text-fg-subtle" />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold" title={session.folder}>
            {session.label}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4 text-[12.5px] tabular-nums">
          <span className="flex items-center gap-1.5 text-ok">
            <Check size={14} /> {kept} kept
          </span>
          <span className="flex items-center gap-1.5 text-danger">
            <X size={14} /> {deleted} deleted
          </span>
          <span className="text-fg-muted">
            {Math.min(index + 1, queue.length)} / {queue.length}
          </span>
          <Button variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={end}>
            End session
          </Button>
        </div>
      </div>
      <div className="h-0.5 shrink-0 bg-line">
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${(Math.min(index, queue.length) / queue.length) * 100}%` }} />
      </div>

      {done ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <PartyPopper size={40} strokeWidth={1.3} className="text-accent" />
          <div className="font-display text-[20px] font-semibold">All done</div>
          <div className="text-[13px] text-fg-muted">
            You went through {plural(queue.length, queue.some((f) => f.kind === "video") ? "item" : "photo")}: kept {kept}, deleted {deleted}.
            {deleted > 0 && !session.permanent && <> Deleted files are in the Recycle Bin.</>}
          </div>
          <div className="mt-2 flex gap-2">
            <Button icon={<Undo2 size={15} />} disabled={!history.length || undoing} onClick={undo}>
              Undo last
            </Button>
            <Button
              icon={<FolderOpen size={15} />}
              onClick={() => {
                const path = session.folder;
                end();
                openFolder(path);
              }}
            >
              Open folder
            </Button>
            <Button variant="primary" onClick={end}>
              Sort another folder
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden px-6 pt-6 pb-2">
            {/* next card, peeking underneath */}
            {queue[index + 1] && (
              <div className="pointer-events-none absolute inset-x-6 top-6 bottom-2 flex justify-center">
                <div className="h-full w-full max-w-[820px] scale-[0.94] rounded-2xl border border-line bg-panel opacity-60">
                  <img src={thumbUrl(queue[index + 1].path, PREVIEW, queue[index + 1].modified)} alt="" draggable={false} className="h-full w-full object-contain p-3" />
                </div>
              </div>
            )}
            <SwipeCard key={`${file.path}#${nonce}`} ref={cardRef} file={file} enterFrom={enterFrom} onDecide={decide} />
          </div>

          {/* controls */}
          <div className="flex shrink-0 items-center justify-center gap-6 pt-2 pb-5">
            <RoundButton label="Delete" hint="←" tone="danger" onClick={() => cardRef.current?.fling("left")}>
              <X size={26} strokeWidth={2.2} />
            </RoundButton>
            <RoundButton label="Undo" hint="Ctrl+Z" small disabled={!history.length || undoing} onClick={undo}>
              {undoing ? <Spinner size={16} /> : <Undo2 size={18} />}
            </RoundButton>
            <RoundButton label="Keep" hint="→" tone="ok" onClick={() => cardRef.current?.fling("right")}>
              <Check size={26} strokeWidth={2.2} />
            </RoundButton>
          </div>
        </>
      )}
    </div>
  );
}

function RoundButton({
  label,
  hint,
  tone,
  small,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  tone?: "ok" | "danger";
  small?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        title={`${label} (${hint})`}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          "flex items-center justify-center rounded-full border bg-elev shadow-lg transition-[transform,background-color,border-color] duration-150 active:scale-90 disabled:pointer-events-none disabled:opacity-35",
          small ? "h-11 w-11 border-line-strong text-fg-muted hover:text-fg" : "h-16 w-16",
          tone === "ok" && "border-ok/40 text-ok hover:border-ok hover:bg-ok/10",
          tone === "danger" && "border-danger/40 text-danger hover:border-danger hover:bg-danger/10",
        )}
      >
        {children}
      </button>
      <span className="text-[11px] text-fg-subtle">{label}</span>
    </div>
  );
}

// ───────────────────────── card ─────────────────────────

interface SwipeCardHandle {
  fling: (dir: "left" | "right") => void;
}

const SwipeCard = forwardRef<
  SwipeCardHandle,
  { file: FileEntry; enterFrom: "left" | "right" | null; onDecide: (d: SwipeDecision) => void }
>(function SwipeCard({ file, enterFrom, onDecide }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fly, setFly] = useState<"left" | "right" | null>(null);
  const [entering, setEntering] = useState(enterFrom);
  const [img, setImg] = useState<"loading" | "ok" | "error">("loading");
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const samples = useRef<{ x: number; t: number }[]>([]);
  const decided = useRef(false);

  // Slide back in from the side it left on (undo).
  useLayoutEffect(() => {
    if (!enterFrom) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setEntering(null)));
    return () => cancelAnimationFrame(r);
  }, [enterFrom]);

  const fling = useCallback(
    (dir: "left" | "right") => {
      if (decided.current) return;
      decided.current = true;
      setDragging(false);
      setFly(dir);
      setTimeout(() => onDecide(dir === "right" ? "keep" : "delete"), FLY_MS);
    },
    [onDecide],
  );
  useImperativeHandle(ref, () => ({ fling }), [fling]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (decided.current || e.button !== 0) return;
    el.current?.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    samples.current = [{ x: e.clientX, t: e.timeStamp }];
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    setDx(e.clientX - s.x);
    setDy((e.clientY - s.y) * 0.35);
    samples.current.push({ x: e.clientX, t: e.timeStamp });
    if (samples.current.length > 6) samples.current.shift();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    const sm = samples.current;
    const first = sm[0];
    const last = sm[sm.length - 1];
    const vx = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const width = el.current?.clientWidth ?? 600;
    const d = swipeOutcome(e.clientX - s.x, vx, width);
    if (d) fling(d === "keep" ? "right" : "left");
    else {
      setDragging(false);
      setDx(0);
      setDy(0);
    }
  };

  const off = typeof window !== "undefined" ? window.innerWidth : 1600;
  let transform: string;
  if (fly) transform = `translate(${fly === "right" ? off : -off}px, ${dy}px) rotate(${fly === "right" ? 24 : -24}deg)`;
  else if (entering) transform = `translate(${entering === "right" ? off : -off}px, 0) rotate(${entering === "right" ? 24 : -24}deg)`;
  else transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.05}deg)`;

  const keepAlpha = fly === "right" ? 1 : Math.max(0, Math.min(1, dx / 120));
  const delAlpha = fly === "left" ? 1 : Math.max(0, Math.min(1, -dx / 120));

  return (
    <div className="absolute inset-x-6 top-6 bottom-2 flex justify-center">
      <div
        ref={el}
        role="group"
        aria-label={`${file.name}. Swipe right to keep, left to delete.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cx(
          "relative flex h-full w-full max-w-[820px] cursor-grab touch-none flex-col overflow-hidden rounded-2xl border bg-panel shadow-2xl shadow-black/40 select-none",
          dragging && "cursor-grabbing",
          keepAlpha > 0.5 ? "border-ok/70" : delAlpha > 0.5 ? "border-danger/70" : "border-line-strong",
        )}
        style={{
          transform,
          transition: dragging ? "none" : `transform ${FLY_MS}ms var(--ease-out-soft), border-color 150ms`,
        }}
      >
        <div className="relative min-h-0 flex-1">
          {img === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner size={22} />
            </div>
          )}
          {img === "error" ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
              <ImageOff size={32} strokeWidth={1.4} />
              <span className="text-[12.5px]">No preview available</span>
            </div>
          ) : (
            <img
              src={thumbUrl(file.path, PREVIEW, file.modified)}
              alt={file.name}
              draggable={false}
              onLoad={() => setImg("ok")}
              onError={() => setImg("error")}
              className={cx("h-full w-full object-contain p-3 transition-opacity duration-150", img === "ok" ? "opacity-100" : "opacity-0")}
            />
          )}
          {file.kind === "video" && img !== "error" && (
            <span className="absolute bottom-4 left-4 flex h-6 items-center gap-1 rounded-md bg-black/65 px-2 text-[11px] font-semibold text-white">
              <Play size={10} fill="currentColor" strokeWidth={0} /> VIDEO
            </span>
          )}
          <Stamp tone="ok" alpha={keepAlpha} side="left">
            KEEP
          </Stamp>
          <Stamp tone="danger" alpha={delAlpha} side="right">
            DELETE
          </Stamp>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-2.5 text-[12px] text-fg-muted">
          <span className="min-w-0 flex-1 truncate font-medium text-fg" title={file.path}>
            {file.name}
          </span>
          {file.size > 0 && <span className="tabular-nums">{formatBytes(file.size)}</span>}
          {file.modified > 0 && <span className="tabular-nums">{formatDate(file.modified)}</span>}
        </div>
      </div>
    </div>
  );
});

function Stamp({ tone, alpha, side, children }: { tone: "ok" | "danger"; alpha: number; side: "left" | "right"; children: React.ReactNode }) {
  return (
    <span
      className={cx(
        "pointer-events-none absolute top-6 rounded-lg border-[3px] px-3 py-1 font-display text-[26px] font-bold tracking-wider",
        side === "left" ? "left-6 -rotate-12" : "right-6 rotate-12",
        tone === "ok" ? "border-ok text-ok" : "border-danger text-danger",
      )}
      style={{ opacity: alpha, background: "color-mix(in srgb, var(--color-bg) 55%, transparent)" }}
    >
      {children}
    </span>
  );
}
