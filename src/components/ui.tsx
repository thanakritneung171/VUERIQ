import { type ButtonHTMLAttributes, type ReactNode, forwardRef, useEffect, useRef, useState } from "react";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: "sm" | "md";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={shortcut ? `${label}  (${shortcut})` : label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150",
        "hover:bg-fg/8 hover:text-fg active:bg-fg/12 disabled:pointer-events-none disabled:opacity-35",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        active && "bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: ReactNode;
};

export function Button({ variant = "secondary", icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-accent text-accent-fg hover:bg-accent-strong",
        variant === "secondary" && "border border-line-strong bg-elev text-fg hover:bg-elev-2",
        variant === "ghost" && "text-fg-muted hover:bg-fg/8 hover:text-fg",
        variant === "danger" && "border border-danger/40 text-danger hover:bg-danger/10",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-panel p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center justify-center gap-1.5 rounded-[5px] px-2.5 font-medium transition-colors duration-150",
            size === "sm" ? "h-6 text-[12px]" : "h-7 text-[12.5px]",
            value === o.value ? "bg-elev-2 text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        className={cx(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  checked?: boolean;
  onSelect: () => void;
  disabled?: boolean;
  separatorBefore?: boolean;
}

/** Small dropdown menu anchored to its trigger. */
export function Menu({
  trigger,
  items,
  align = "left",
  side = "bottom",
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean }) => ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  side?: "bottom" | "top";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open })}
      {open && (
        <div
          role="menu"
          className={cx(
            "animate-pop-in absolute z-50 min-w-44 rounded-lg border border-line-strong bg-elev p-1 shadow-2xl shadow-black/40",
            align === "right" ? "right-0" : "left-0",
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
          )}
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.separatorBefore && <div className="my-1 h-px bg-line" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-fg hover:bg-fg/8 disabled:opacity-40"
              >
                <span className="flex w-4 justify-center text-fg-muted">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.checked && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-elev-2 px-1.5 font-mono text-[11px] text-fg-muted">
      {children}
    </kbd>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-fg-muted" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
