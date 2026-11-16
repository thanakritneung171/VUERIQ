// Sort, filter, view mode and search above a gallery.
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, Search, X } from "lucide-react";
import { type ReactNode } from "react";
import type { KindFilter, SortKey } from "../../lib/types";
import { useApp } from "../../store/app";
import { IconButton, Menu, Segmented } from "../ui";

export const SORT_LABEL: Record<SortKey, string> = { name: "Name", date: "Date modified", size: "Size", type: "Type" };

export function GalleryToolbar({ count, total, leading }: { count: number; total: number; leading?: ReactNode }) {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const search = useApp((s) => s.search);
  const setSearch = useApp((s) => s.setSearch);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
      {leading}
      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files"
            spellCheck={false}
            className="h-8 w-48 rounded-md border border-line bg-panel pr-7 pl-8 text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent/60 focus:outline-none"
            onKeyDown={(e) => e.key === "Escape" && setSearch("")}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <Segmented<KindFilter>
          value={settings.kindFilter}
          onChange={(v) => update({ kindFilter: v })}
          options={[
            { value: "all", label: "All" },
            { value: "image", label: "Images" },
            { value: "video", label: "Videos" },
          ]}
        />
        <Menu
          align="right"
          trigger={(p) => (
            <button
              type="button"
              {...p}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-fg-muted hover:bg-fg/8 hover:text-fg"
              title="Sort"
            >
              {settings.sortDesc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
              {SORT_LABEL[settings.sortKey]}
            </button>
          )}
          items={[
            ...(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
              label: SORT_LABEL[k],
              checked: settings.sortKey === k,
              onSelect: () => update({ sortKey: k }),
            })),
            { label: "Ascending", checked: !settings.sortDesc, onSelect: () => update({ sortDesc: false }), separatorBefore: true },
            { label: "Descending", checked: settings.sortDesc, onSelect: () => update({ sortDesc: true }) },
          ]}
        />
        <div className="flex items-center">
          <IconButton label="Grid view" active={settings.viewMode === "grid"} onClick={() => update({ viewMode: "grid" })}>
            <LayoutGrid size={16} />
          </IconButton>
          <IconButton label="List view" active={settings.viewMode === "list"} onClick={() => update({ viewMode: "list" })}>
            <List size={16} />
          </IconButton>
        </div>
        {settings.viewMode === "grid" && (
          <input
            type="range"
            aria-label="Thumbnail size"
            title="Thumbnail size"
            min={112}
            max={320}
            step={8}
            value={settings.thumbnailSize}
            onChange={(e) => update({ thumbnailSize: Number(e.target.value) })}
            className="vq-range w-20"
            style={{ ["--vq-fill" as string]: `${((settings.thumbnailSize - 112) / 208) * 100}%` }}
          />
        )}
        <span className="w-20 text-right text-[12px] tabular-nums text-fg-subtle">
          {count === total ? `${total} items` : `${count} of ${total}`}
        </span>
      </div>
    </div>
  );
}
