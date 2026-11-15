import { Clock, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Gallery, GalleryToolbar } from "../components/Gallery";
import { Button } from "../components/ui";
import { api } from "../lib/api";
import type { FileEntry } from "../lib/types";
import { entryFromPath, useApp } from "../store/app";

/** Recent and Favorites: galleries built from a list of paths (which may no longer exist). */
export function CollectionView({ kind }: { kind: "recent" | "favorites" }) {
  const paths = useApp((s) => (kind === "recent" ? s.recent : s.favorites));
  const clearRecent = useApp((s) => s.clearRecent);
  const removeRecent = useApp((s) => s.removeRecent);
  const toggleFavorite = useApp((s) => s.toggleFavorite);
  const fsVersion = useApp((s) => s.fsVersion);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const files = useMemo(() => paths.map(entryFromPath).filter(Boolean) as FileEntry[], [paths]);

  useEffect(() => {
    let alive = true;
    api
      .pathExists(paths)
      .then((ex) => {
        if (alive) setMissing(new Set(paths.filter((_, i) => !ex[i])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [paths, fsVersion]);

  const title = kind === "recent" ? "Recent" : "Favorites";
  const Icon = kind === "recent" ? Clock : Star;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <GalleryToolbar
        count={files.length}
        total={files.length}
        leading={
          <div className="flex items-center gap-3">
            <Icon size={16} className="text-fg-subtle" />
            <h1 className="text-[14px] font-semibold">{title}</h1>
            {kind === "recent" && files.length > 0 && (
              <Button variant="ghost" className="h-7 px-2 text-[12px]" icon={<Trash2 size={13} />} onClick={clearRecent}>
                Clear
              </Button>
            )}
          </div>
        }
      />
      <Gallery
        files={files}
        missing={missing}
        onRemove={kind === "recent" ? removeRecent : toggleFavorite}
        emptyState={
          <div className="flex flex-col items-center gap-3 text-center">
            <Icon size={34} strokeWidth={1.25} className="text-fg-subtle" />
            <div className="text-[14px] font-medium">{kind === "recent" ? "Nothing opened yet" : "No favorites yet"}</div>
            <div className="max-w-xs text-[12.5px] text-fg-muted">
              {kind === "recent"
                ? "Images and videos you open appear here."
                : "Press F in the viewer or click the star on a thumbnail to add a favorite."}
            </div>
          </div>
        }
      />
    </div>
  );
}
