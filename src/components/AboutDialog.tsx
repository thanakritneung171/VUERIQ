import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AppInfo } from "../lib/types";
import { useApp } from "../store/app";
import { LogoMark } from "./Logo";
import { IconButton } from "./ui";

export function AboutDialog() {
  const open = useApp((s) => s.aboutOpen);
  const setOpen = useApp((s) => s.setAboutOpen);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (open) api.appInfo().then(setInfo).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="animate-fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="About VUERIQ"
        className="animate-pop-in relative w-[420px] rounded-2xl border border-line-strong bg-elev p-8 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <IconButton label="Close" size="sm" className="absolute top-3 right-3" onClick={() => setOpen(false)}>
          <X size={15} />
        </IconButton>
        <div className="flex flex-col items-center text-center">
          <LogoMark size={84} />
          <h2 className="mt-4 text-[22px] font-semibold tracking-[0.16em]" style={{ fontFamily: "var(--font-display)" }}>
            VUERIQ
          </h2>
          <p className="mt-1 text-[13px] text-fg-muted">See Every Detail.</p>
          <p className="mt-3 text-[12px] tabular-nums text-fg-subtle">Version {info?.version ?? "—"}</p>
        </div>
        <dl className="mt-6 space-y-1.5 rounded-lg border border-line bg-panel p-4 text-[12px]">
          <Item k="Image engine" v={`libheif ${info?.libheif ?? "—"} · image-rs · rawler · jxl-oxide`} />
          <Item k="Video engine" v={info?.mpv ?? "Not loaded"} />
          <Item k="Runtime" v={`Tauri ${info?.tauri ?? "—"} · WebView2`} />
          <Item k="Mode" v={info?.portable ? "Portable" : "Installed"} />
        </dl>
        <p className="mt-5 text-center text-[11px] leading-relaxed text-fg-subtle">
          © 2026 VUERIQ. Includes open-source components; see THIRD_PARTY_NOTICES in the installation folder.
        </p>
      </div>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2">
      <dt className="text-fg-subtle">{k}</dt>
      <dd className="break-words text-fg">{v}</dd>
    </div>
  );
}
