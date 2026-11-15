import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TriangleAlert, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { AboutDialog } from "./components/AboutDialog";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { cx } from "./components/ui";
import { api, isTauri } from "./lib/api";
import { pickFiles } from "./lib/dialogs";
import { useApp } from "./store/app";
import { BrowseView } from "./views/BrowseView";
import { CollectionView } from "./views/CollectionView";
import { HomeView } from "./views/HomeView";
import { SettingsView } from "./views/SettingsView";
import { Viewer } from "./views/Viewer";

let booted = false;

export default function App() {
  const ready = useApp((s) => s.ready);
  const section = useApp((s) => s.section);
  const viewer = useApp((s) => s.viewer);
  const theme = useApp((s) => s.settings.theme);
  const fullscreen = useApp((s) => s.fullscreen);
  const toast = useApp((s) => s.toast);
  const [dragOver, setDragOver] = useState(false);

  // Boot: restore state, then open whatever Windows passed us (file association / "Open with").
  useEffect(() => {
    if (booted) return;
    booted = true;
    const st = useApp.getState();
    st.init().then(async () => {
      try {
        const files = await api.launchFiles();
        if (files.length) await useApp.getState().openPaths(files);
      } catch {
        /* ignore */
      }
      if (isTauri) getCurrentWindow().show();
    });
  }, []);

  // Second instance (double-click another file while running) → forwarded here.
  useEffect(() => {
    if (!isTauri) return;
    const un = listen<string[]>("open-files", (e) => {
      useApp.getState().openPaths(e.payload);
      getCurrentWindow().setFocus();
    });
    return () => void un.then((u) => u());
  }, []);

  // Drag & drop from Explorer
  useEffect(() => {
    if (!isTauri) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setDragOver(true);
      else if (p.type === "leave") setDragOver(false);
      else if (p.type === "drop") {
        setDragOver(false);
        if (p.paths.length) useApp.getState().openPaths(p.paths);
      }
    });
    return () => void un.then((u) => u());
  }, []);

  // Theme
  useEffect(() => {
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("light", !dark);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        pickFiles().then((f) => {
          if (f.length) useApp.getState().openPaths(f);
        });
      } else if (e.key === "F5" && !useApp.getState().viewer) {
        e.preventDefault();
        useApp.getState().refreshFolder();
      } else if ((e.ctrlKey && (e.key === "r" || e.key === "R")) || (e.ctrlKey && e.shiftKey && e.key === "I")) {
        e.preventDefault(); // block WebView reload/devtools in production
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Suppress the default WebView context menu everywhere except text fields.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  const title = viewer ? viewer.items[viewer.index]?.name : undefined;
  const videoActive = viewer?.items[viewer.index]?.kind === "video";

  return (
    <div className="flex h-full flex-col">
      {!fullscreen && <TitleBar title={title} />}
      <div className="flex min-h-0 flex-1">
        {!fullscreen && <Sidebar />}
        {/* No background on <main> while a video plays: the engine renders behind the WebView. */}
        <main className={cx("relative flex min-w-0 flex-1 flex-col", !videoActive && "bg-bg")}>
          {!ready ? null : viewer ? (
            <Viewer />
          ) : section === "home" ? (
            <HomeView />
          ) : section === "recent" ? (
            <CollectionView kind="recent" />
          ) : section === "favorites" ? (
            <CollectionView kind="favorites" />
          ) : section === "browse" ? (
            <BrowseView />
          ) : (
            <SettingsView />
          )}
        </main>
      </div>

      {dragOver && (
        <div className="animate-fade-in pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/60 px-16 py-12">
            <Upload size={34} className="text-accent" />
            <div className="text-[15px] font-medium">Drop to open in VUERIQ</div>
          </div>
        </div>
      )}

      {toast && (
        <div className="animate-pop-in fixed bottom-6 left-1/2 z-[95] -translate-x-1/2">
          <div
            className={cx(
              "flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-[13px] shadow-2xl",
              toast.tone === "error" ? "border-danger/40 bg-elev text-fg" : "border-line-strong bg-elev text-fg",
            )}
          >
            {toast.tone === "error" && <TriangleAlert size={15} className="text-danger" />}
            {toast.message}
          </div>
        </div>
      )}
      <AboutDialog />
    </div>
  );
}
