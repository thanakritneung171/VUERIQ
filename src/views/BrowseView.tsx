import { ArrowUp, ChevronRight, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { Gallery, GalleryToolbar } from "../components/Gallery";
import { Button, IconButton, Spinner } from "../components/ui";
import { pickFolder } from "../lib/dialogs";
import { useApp } from "../store/app";
import { useMemo } from "react";

function crumbs(path: string): { label: string; path: string }[] {
  const unc = path.startsWith("\\\\");
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.map((label, i) => {
    let p = parts.slice(0, i + 1).join("\\");
    if (unc) p = "\\\\" + p;
    else if (i === 0 && /^[A-Za-z]:$/.test(label)) p += "\\";
    return { label, path: p };
  });
}

export function BrowseView() {
  const folder = useApp((s) => s.folder);
  const loading = useApp((s) => s.folderLoading);
  const error = useApp((s) => s.folderError);
  const openFolder = useApp((s) => s.openFolder);
  const refresh = useApp((s) => s.refreshFolder);
  const search = useApp((s) => s.search);
  const filter = useApp((s) => s.settings.kindFilter);

  const count = useMemo(() => {
    if (!folder) return 0;
    const q = search.trim().toLowerCase();
    return folder.files.filter((f) => (filter === "all" || f.kind === filter) && (!q || f.name.toLowerCase().includes(q))).length;
  }, [folder, search, filter]);

  const choose = async () => {
    const f = await pickFolder();
    if (f) openFolder(f);
  };

  if (!folder && !loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4 text-center">
          {error ? (
            <>
              <TriangleAlert size={34} strokeWidth={1.4} className="text-warn" />
              <div className="text-[15px] font-medium">Can't open this folder</div>
              <div className="max-w-sm text-[13px] text-fg-muted">{error.message}</div>
            </>
          ) : (
            <>
              <FolderOpen size={38} strokeWidth={1.2} className="text-fg-subtle" />
              <div className="text-[15px] font-medium">Browse a folder</div>
              <div className="max-w-sm text-[13px] text-fg-muted">Pick any folder to see its images and videos as a gallery.</div>
            </>
          )}
          <Button variant="primary" icon={<FolderOpen size={15} />} onClick={choose}>
            Choose Folder
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <GalleryToolbar
        count={count}
        total={folder?.files.length ?? 0}
        leading={
          <div className="flex min-w-0 items-center gap-1">
            <IconButton label="Up one level" disabled={!folder?.parent} onClick={() => folder?.parent && openFolder(folder.parent)}>
              <ArrowUp size={16} />
            </IconButton>
            <IconButton label="Refresh" shortcut="F5" onClick={refresh}>
              <RefreshCw size={15} />
            </IconButton>
            <IconButton label="Choose folder" onClick={choose}>
              <FolderOpen size={16} />
            </IconButton>
            <div className="ml-1 flex min-w-0 items-center overflow-hidden text-[13px]">
              {folder &&
                crumbs(folder.path).map((c, i, arr) => (
                  <span key={c.path} className="flex min-w-0 items-center">
                    {i > 0 && <ChevronRight size={13} className="mx-0.5 shrink-0 text-fg-subtle" />}
                    <button
                      type="button"
                      onClick={() => openFolder(c.path)}
                      className={
                        i === arr.length - 1
                          ? "truncate rounded px-1.5 py-0.5 font-medium text-fg"
                          : "truncate rounded px-1.5 py-0.5 text-fg-muted hover:bg-fg/8 hover:text-fg"
                      }
                    >
                      {c.label}
                    </button>
                  </span>
                ))}
            </div>
            {loading && <Spinner size={16} />}
          </div>
        }
      />
      {error && folder && (
        <div className="border-b border-line bg-warn/8 px-5 py-2 text-[12.5px] text-warn">{error.message}</div>
      )}
      {folder && <Gallery files={folder.files} dirs={folder.dirs} onOpenDir={openFolder} />}
    </div>
  );
}
