// Right-click menu for gallery items.
import { useEffect } from "react";
import { cx } from "../ui";

export interface CtxItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hint?: string;
  separatorBefore?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: CtxItem[]; onClose: () => void }) {
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
