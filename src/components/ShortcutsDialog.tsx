import { Keyboard, X } from "lucide-react";
import { useEffect } from "react";
import { SHORTCUT_GROUPS } from "../lib/shortcutList";
import { useApp } from "../store/app";
import { IconButton, Kbd } from "./ui";

/** Grouped shortcut list; also used inline on the Settings page. */
export function ShortcutList({ columns = 2 }: { columns?: 1 | 2 }) {
  return (
    <div className={columns === 2 ? "grid grid-cols-2 gap-x-10 gap-y-5" : "space-y-5"}>
      {SHORTCUT_GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-fg-subtle uppercase">{g.title}</h3>
          <div className="space-y-1.5 text-[12.5px]">
            {g.items.map(([k, d]) => (
              <div key={d} className="flex items-center justify-between gap-3">
                <span className="text-fg-muted">{d}</span>
                <span className="flex shrink-0 gap-1">
                  {k.split(" ").map((x) => (
                    <Kbd key={x}>{x}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** "?" anywhere (outside text fields) opens this. */
export function ShortcutsDialog() {
  const open = useApp((s) => s.shortcutsOpen);
  const setOpen = useApp((s) => s.setShortcutsOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      if (st.shortcutsOpen) {
        // Modal: keys never reach the gallery or viewer underneath.
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "?") {
          e.preventDefault();
          setOpen(false);
        }
        return;
      }
      if (e.key !== "?" || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      if (st.confirm || st.aboutOpen) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setOpen]);

  if (!open) return null;
  return (
    <div
      className="animate-fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="animate-pop-in relative max-h-full w-[720px] max-w-full overflow-y-auto rounded-2xl border border-line-strong bg-elev p-7 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <IconButton label="Close" shortcut="Esc" size="sm" className="absolute top-3 right-3" onClick={() => setOpen(false)}>
          <X size={15} />
        </IconButton>
        <h2 className="mb-6 flex items-center gap-2.5 text-[16px] font-semibold">
          <Keyboard size={18} className="text-accent" />
          Keyboard shortcuts
        </h2>
        <ShortcutList />
      </div>
    </div>
  );
}
