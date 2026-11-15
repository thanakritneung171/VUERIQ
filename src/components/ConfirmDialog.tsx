import { TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { useApp } from "../store/app";
import { Button } from "./ui";

/** Modal confirmation driven by `useApp().askConfirm()`. */
export function ConfirmDialog() {
  const req = useApp((s) => s.confirm);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        req.resolve(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req]);

  if (!req) return null;
  return (
    <div className="animate-fade-in fixed inset-0 z-[110] flex items-center justify-center bg-black/55 backdrop-blur-[2px]" onMouseDown={() => req.resolve(false)}>
      <div
        role="alertdialog"
        aria-label={req.title}
        className="animate-pop-in w-[400px] rounded-xl border border-line-strong bg-elev p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {req.danger && <TriangleAlert size={20} className="mt-0.5 shrink-0 text-danger" />}
          <div>
            <div className="text-[15px] font-semibold">{req.title}</div>
            <div className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{req.message}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} onClick={() => req.resolve(false)}>
            Cancel
          </Button>
          <Button variant={req.danger ? "danger" : "primary"} onClick={() => req.resolve(true)}>
            {req.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
