import { Clock, CopyCheck, FolderOpen, GalleryHorizontalEnd, Home, Keyboard, Settings, Star } from "lucide-react";
import type { ReactNode } from "react";
import { type Section, useApp } from "../store/app";
import { cx } from "./ui";

const NAV: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <Home size={17} strokeWidth={1.75} /> },
  { id: "recent", label: "Recent", icon: <Clock size={17} strokeWidth={1.75} /> },
  { id: "favorites", label: "Favorites", icon: <Star size={17} strokeWidth={1.75} /> },
  { id: "browse", label: "Browse Folders", icon: <FolderOpen size={17} strokeWidth={1.75} /> },
];

export function Sidebar() {
  const section = useApp((s) => s.section);
  const viewerOpen = useApp((s) => s.viewer !== null);
  const setSection = useApp((s) => s.setSection);
  const setShortcutsOpen = useApp((s) => s.setShortcutsOpen);
  const recentCount = useApp((s) => s.recent.length);
  const favCount = useApp((s) => s.favorites.length);

  const counts: Partial<Record<Section, number>> = { recent: recentCount, favorites: favCount };

  return (
    <nav className="flex w-[212px] shrink-0 flex-col border-r border-line bg-panel px-2.5 py-3">
      <div className="space-y-0.5">
        {NAV.map((n) => (
          <NavItem
            key={n.id}
            active={section === n.id && !viewerOpen}
            dim={section === n.id && viewerOpen}
            icon={n.icon}
            label={n.label}
            count={counts[n.id]}
            onClick={() => setSection(n.id)}
          />
        ))}
      </div>
      <div className="mt-5 mb-1.5 px-3 text-[10.5px] font-semibold tracking-wider text-fg-subtle uppercase">Tools</div>
      <div className="space-y-0.5">
        <NavItem
          active={section === "swipe" && !viewerOpen}
          dim={section === "swipe" && viewerOpen}
          icon={<GalleryHorizontalEnd size={17} strokeWidth={1.75} />}
          label="Swipe Sort"
          onClick={() => setSection("swipe")}
        />
        <NavItem
          active={section === "duplicates" && !viewerOpen}
          dim={section === "duplicates" && viewerOpen}
          icon={<CopyCheck size={17} strokeWidth={1.75} />}
          label="Find Duplicates"
          onClick={() => setSection("duplicates")}
        />
      </div>
      <div className="mt-auto space-y-0.5 border-t border-line pt-2.5">
        <NavItem
          active={section === "settings" && !viewerOpen}
          icon={<Settings size={17} strokeWidth={1.75} />}
          label="Settings"
          onClick={() => setSection("settings")}
        />
        <NavItem
          active={false}
          icon={<Keyboard size={17} strokeWidth={1.75} />}
          label="Shortcuts"
          hint="?"
          onClick={() => setShortcutsOpen(true)}
        />
      </div>
    </nav>
  );
}

function NavItem({
  active,
  dim,
  icon,
  label,
  count,
  hint,
  onClick,
}: {
  active: boolean;
  dim?: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group relative flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] font-medium transition-colors duration-150",
        active ? "bg-fg/8 text-fg" : dim ? "text-fg" : "text-fg-muted hover:bg-fg/5 hover:text-fg",
      )}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent" />}
      <span className={cx(active ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted")}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {!!count && <span className="text-[11px] tabular-nums text-fg-subtle">{count}</span>}
      {hint && (
        <kbd className="rounded border border-line px-1.5 font-mono text-[10.5px] text-fg-subtle">{hint}</kbd>
      )}
    </button>
  );
}
