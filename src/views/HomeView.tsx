import { Download, File, FolderOpen, HardDrive, Image, Monitor, Video } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { LogoMark } from "../components/Logo";
import { Thumb } from "../components/Thumb";
import { Button, Kbd } from "../components/ui";
import { api } from "../lib/api";
import { pickFiles, pickFolder } from "../lib/dialogs";
import type { FileEntry, Place, Places } from "../lib/types";
import { entryFromPath } from "../lib/entries";
import { useApp } from "../store/app";

const PLACE_ICON: Record<string, ReactNode> = {
  pictures: <Image size={16} strokeWidth={1.75} />,
  videos: <Video size={16} strokeWidth={1.75} />,
  desktop: <Monitor size={16} strokeWidth={1.75} />,
  downloads: <Download size={16} strokeWidth={1.75} />,
  documents: <File size={16} strokeWidth={1.75} />,
};

export function HomeView() {
  const openPaths = useApp((s) => s.openPaths);
  const openFolder = useApp((s) => s.openFolder);
  const openViewer = useApp((s) => s.openViewer);
  const recent = useApp((s) => s.recent);
  const setSection = useApp((s) => s.setSection);
  const [places, setPlaces] = useState<Places | null>(null);

  useEffect(() => {
    api.places().then(setPlaces).catch(() => {});
  }, []);

  const recentEntries = useMemo(
    () => recent.slice(0, 8).map(entryFromPath).filter(Boolean) as FileEntry[],
    [recent],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto max-w-5xl px-10 pt-14 pb-12">
        <div className="animate-fade-in flex items-center gap-5">
          <LogoMark size={64} />
          <div>
            <h1 className="text-[30px] leading-tight font-semibold tracking-[0.14em]" style={{ fontFamily: "var(--font-display)" }}>
              VUERIQ
            </h1>
            <p className="mt-0.5 text-[14px] text-fg-muted">See Every Detail.</p>
          </div>
        </div>

        <div className="mt-9 flex flex-wrap gap-3">
          <Button variant="primary" className="h-10 px-4" icon={<File size={16} />} onClick={async () => openPaths(await pickFiles())}>
            Open Files
          </Button>
          <Button
            className="h-10 px-4"
            icon={<FolderOpen size={16} />}
            onClick={async () => {
              const f = await pickFolder();
              if (f) openFolder(f);
            }}
          >
            Browse Folder
          </Button>
          <div className="ml-auto hidden items-center gap-2 text-[12px] text-fg-subtle md:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>O</Kbd>
            <span className="mr-3">Open</span>
            <span>or drop files anywhere</span>
          </div>
        </div>

        {places && (
          <section className="mt-12">
            <SectionTitle>Quick Access</SectionTitle>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
              {places.home.map((p) => (
                <PlaceCard key={p.id} place={p} icon={PLACE_ICON[p.id] ?? <FolderOpen size={16} />} onClick={() => openFolder(p.path)} />
              ))}
              {places.drives.map((p) => (
                <PlaceCard key={p.id} place={p} icon={<HardDrive size={16} strokeWidth={1.75} />} onClick={() => openFolder(p.path)} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-12">
          <div className="flex items-baseline justify-between">
            <SectionTitle>Recently Opened</SectionTitle>
            {recent.length > 8 && (
              <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => setSection("recent")}>
                View all
              </button>
            )}
          </div>
          {recentEntries.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
              {recentEntries.map((f, i) => (
                <button
                  key={f.path}
                  type="button"
                  title={f.path}
                  onClick={() => openViewer(recentEntries, i)}
                  className="group text-left"
                >
                  <div className="aspect-square overflow-hidden rounded-lg border border-line bg-panel transition-colors group-hover:border-line-strong">
                    <Thumb file={f} size={140} className="h-full w-full p-1.5" />
                  </div>
                  <div className="mt-1.5 truncate text-[12px] text-fg-muted group-hover:text-fg">{f.name}</div>
                  <div className="truncate text-[11px] text-fg-subtle">{parentName(f.path)}</div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-fg-subtle">Files you open will appear here.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Folder the file is in, so two files with the same name can be told apart. */
function parentName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-fg-subtle uppercase">{children}</h2>;
}

function PlaceCard({ place, icon, onClick }: { place: Place; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={place.path}
      className="flex h-12 items-center gap-3 rounded-lg border border-line bg-panel px-3.5 text-left transition-colors hover:border-line-strong hover:bg-elev"
    >
      <span className="text-fg-subtle">{icon}</span>
      <span className="truncate text-[13px] font-medium">{place.label}</span>
    </button>
  );
}
