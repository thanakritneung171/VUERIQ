import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "../lib/api";
import { LogoMark, Wordmark } from "./Logo";
import { cx } from "./ui";

export function TitleBar({ title }: { title?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const w = getCurrentWindow();
    let un: (() => void) | undefined;
    w.isMaximized().then(setMaximized);
    w.onResized(() => w.isMaximized().then(setMaximized)).then((u) => (un = u));
    return () => un?.();
  }, []);

  const win = isTauri ? getCurrentWindow() : null;

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-9 shrink-0 items-center border-b border-line bg-panel pl-3"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        win?.toggleMaximize();
      }}
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <LogoMark size={18} />
        <Wordmark className="pointer-events-none text-[11px] text-fg" />
      </div>
      <div
        data-tauri-drag-region
        className="pointer-events-none absolute inset-x-40 truncate text-center text-[12px] text-fg-muted"
      >
        {title}
      </div>
      <div className="ml-auto flex h-full">
        <WinButton label="Minimize" onClick={() => win?.minimize()}>
          <Minus size={15} strokeWidth={1.5} />
        </WinButton>
        <WinButton label={maximized ? "Restore" : "Maximize"} onClick={() => win?.toggleMaximize()}>
          {maximized ? <Copy size={12} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={12} strokeWidth={1.5} />}
        </WinButton>
        <WinButton label="Close" danger onClick={() => win?.close()}>
          <X size={16} strokeWidth={1.5} />
        </WinButton>
      </div>
    </header>
  );
}

function WinButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        "flex h-full w-[46px] items-center justify-center text-fg-muted transition-colors duration-100",
        danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-fg/8 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
