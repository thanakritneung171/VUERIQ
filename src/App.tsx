import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TriangleAlert, Upload } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { AboutDialog } from "./components/AboutDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { cx } from "./components/ui";
import { api, isTauri } from "./lib/api";
import { pickFiles } from "./lib/dialogs";
import { useApp } from "./store/app";
import { Viewer } from "./views/Viewer";

// Only the viewer is in the startup bundle, so a file opened from Explorer shows as fast as possible.
const BrowseView = lazy(() =>
  import("./views/BrowseView").then((m) => ({ default: m.BrowseView })),
);
const CollectionView = lazy(() =>
  import("./views/CollectionView").then((m) => ({ default: m.CollectionView })),
);
const DuplicatesView = lazy(() =>
  import("./views/DuplicatesView").then((m) => ({ default: m.DuplicatesView })),
);
const HomeView = lazy(() =>
  import("./views/HomeView").then((m) => ({ default: m.HomeView })),
);
const SettingsView = lazy(() =>
  import("./views/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const SwipeView = lazy(() =>
  import("./views/SwipeView").then((m) => ({ default: m.SwipeView })),
);

let booted = false;

export default function App() {
  const ready = useApp((s) => s.ready);
  const section = useApp((s) => s.section);
  const viewer = useApp((s) => s.viewer);
  const theme = useApp((s) => s.settings.theme);
  const fullscreen = useApp((s) => s.fullscreen);
  const quick = useApp((s) => s.quick);
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
        if (files.length) {
          // Opened from Explorer → quick viewer (just the photo / video), like Photos or Media Player.
          if (useApp.getState().settings.quickViewer)
            useApp.setState({ quick: true });
          const opening = useApp.getState().openPaths(files);
          // openPaths shows the file first and lists its folder afterwards; don't wait for that.
          if (useApp.getState().viewer) {
            if (isTauri) getCurrentWindow().show();
          }
          await opening;
          if (!useApp.getState().viewer) useApp.setState({ quick: false });
        }
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
      const dark =
        theme === "dark" ||
        (theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
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
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === "z" || e.key === "Z")
      ) {
        const st = useApp.getState();
        const inField =
          e.target instanceof Element && e.target.closest("input, textarea");
        // Swipe Sort has its own undo history.
        if (inField || st.confirm || (st.section === "swipe" && !st.viewer))
          return;
        e.preventDefault();
        st.undo();
      } else if (e.key === "F5" && !useApp.getState().viewer) {
        e.preventDefault();
        useApp.getState().refreshFolder();
      } else if (
        (e.ctrlKey && (e.key === "r" || e.key === "R")) ||
        (e.ctrlKey && e.shiftKey && e.key === "I")
      ) {
        e.preventDefault(); // block WebView reload/devtools in production
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Suppress the default WebView context menu everywhere except text fields.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (!(e.target instanceof Element && e.target.closest("input, textarea")))
        e.preventDefault();
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
        {!fullscreen && !(quick && viewer) && <Sidebar />}
        {/* No background on <main> while a video plays: the engine renders behind the WebView. */}
        <main
          className={cx(
            "relative flex min-w-0 flex-1 flex-col",
            !videoActive && "bg-bg",
          )}
        >
          {!ready ? null : viewer ? (
            <Viewer />
          ) : (
            <Suspense fallback={null}>
              {section === "home" ? (
                <HomeView />
              ) : section === "recent" ? (
                <CollectionView kind="recent" />
              ) : section === "favorites" ? (
                <CollectionView kind="favorites" />
              ) : section === "browse" ? (
                <BrowseView />
              ) : section === "swipe" ? (
                <SwipeView />
              ) : section === "duplicates" ? (
                <DuplicatesView />
              ) : (
                <SettingsView />
              )}
            </Suspense>
          )}
        </main>
      </div>

      {dragOver && (
        <div className="animate-fade-in pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/60 px-16 py-12">
            <Upload size={34} className="text-accent" />
            <div className="text-[15px] font-medium">
              Drop to open in VUERIQ
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          key={toast.id}
          className="animate-pop-in fixed bottom-20 left-1/2 z-[95] -translate-x-1/2"
        >
          <div
            className={cx(
              "flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-[13px] shadow-2xl",
              toast.tone === "error"
                ? "border-danger/40 bg-elev text-fg"
                : "border-line-strong bg-elev text-fg",
            )}
          >
            {toast.tone === "error" && (
              <TriangleAlert size={15} className="text-danger" />
            )}
            {toast.message}
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  useApp.setState({ toast: null });
                  toast.action!.run();
                }}
                className="-my-1 ml-2 rounded-md px-2 py-1 text-[13px] font-semibold text-accent hover:bg-accent/12"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        </div>
      )}
      <AboutDialog />
      <ConfirmDialog />
    </div>
  );
}
