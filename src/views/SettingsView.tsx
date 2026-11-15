import { CheckCircle2, ExternalLink, Info, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button, Kbd, Segmented, Toggle } from "../components/ui";
import { api } from "../lib/api";
import { formatBytes } from "../lib/formats";
import type { AssociationStatus, CacheStats, Theme, VideoEngineInfo, ViewerBackground } from "../lib/types";
import { useApp } from "../store/app";

export function SettingsView() {
  const s = useApp((st) => st.settings);
  const update = useApp((st) => st.updateSettings);
  const setAboutOpen = useApp((st) => st.setAboutOpen);
  const showToast = useApp((st) => st.showToast);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [assoc, setAssoc] = useState<AssociationStatus | null>(null);
  const [video, setVideo] = useState<VideoEngineInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.cacheStats().then(setStats).catch(() => {});
    api.associationStatus().then(setAssoc).catch(() => {});
    api.videoInfo().then(setVideo).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto max-w-3xl px-10 py-10">
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>

        <Group title="Appearance">
          <Row label="Theme" hint="Dark is recommended for viewing photos.">
            <Segmented<Theme>
              value={s.theme}
              onChange={(v) => update({ theme: v })}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "System" },
              ]}
            />
          </Row>
          <Row label="Viewer background" hint="Shown behind images and through transparent areas.">
            <div className="flex items-center gap-2">
              <select
                value={s.viewerBackground}
                onChange={(e) => update({ viewerBackground: e.target.value as ViewerBackground })}
                className="h-8 rounded-md border border-line-strong bg-elev px-2 text-[13px] text-fg"
              >
                <option value="default">Default</option>
                <option value="black">Black</option>
                <option value="gray">Gray</option>
                <option value="white">White</option>
                <option value="checker">Checkerboard</option>
                <option value="custom">Custom color</option>
              </select>
              {s.viewerBackground === "custom" && (
                <input
                  type="color"
                  value={s.customBackground}
                  onChange={(e) => update({ customBackground: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded border border-line-strong bg-transparent"
                  aria-label="Custom background color"
                />
              )}
            </div>
          </Row>
          <Row label="Smooth transitions" hint="Animate zoom and fades.">
            <Toggle label="Smooth transitions" checked={s.smoothTransitions} onChange={(v) => update({ smoothTransitions: v })} />
          </Row>
        </Group>

        <Group title="Image Viewer">
          <Row label="Enlarge small images to fit" hint="When off, images smaller than the window open at 100%.">
            <Toggle label="Enlarge small images" checked={s.enlargeSmallImages} onChange={(v) => update({ enlargeSmallImages: v })} />
          </Row>
          <Row label="Sharp pixels when zoomed in" hint="Show exact pixels (no interpolation) at 200% and above.">
            <Toggle label="Sharp pixels" checked={s.pixelatedZoom} onChange={(v) => update({ pixelatedZoom: v })} />
          </Row>
          <Row label="Wrap around at folder ends" hint="Next on the last file returns to the first.">
            <Toggle label="Loop navigation" checked={s.loopNavigation} onChange={(v) => update({ loopNavigation: v })} />
          </Row>
          <Row label="Decoded image memory" hint="Upper bound for full-resolution images kept in memory for instant navigation.">
            <select
              value={s.memoryBudgetMb}
              onChange={(e) => update({ memoryBudgetMb: Number(e.target.value) })}
              className="h-8 rounded-md border border-line-strong bg-elev px-2 text-[13px] text-fg"
            >
              {[512, 1024, 1536, 2048, 3072, 4096].map((m) => (
                <option key={m} value={m}>
                  {m >= 1024 ? `${m / 1024} GB` : `${m} MB`}
                </option>
              ))}
            </select>
          </Row>
        </Group>

        <Group title="Video">
          <Row label="Video engine" hint={video?.library ?? undefined}>
            {video ? (
              video.available ? (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ok">
                  <CheckCircle2 size={14} /> {video.version ?? "libmpv"}
                </span>
              ) : (
                <span className="max-w-xs text-right text-[12px] text-warn">{video.error ?? "Not available"}</span>
              )
            ) : (
              <span className="text-[12px] text-fg-subtle">Checking…</span>
            )}
          </Row>
          <Row label="Hardware decoding" hint="Use the GPU for H.264, HEVC, VP9 and AV1 when available. Falls back to software automatically.">
            <Toggle label="Hardware decoding" checked={s.videoHwdec} onChange={(v) => update({ videoHwdec: v })} />
          </Row>
          <Row label="Loop videos">
            <Toggle label="Loop videos" checked={s.videoLoop} onChange={(v) => update({ videoLoop: v })} />
          </Row>
        </Group>

        <Group title="Windows Integration">
          <Row
            label="Open supported files with VUERIQ"
            hint={
              assoc?.registered
                ? "VUERIQ is registered for images and videos. Choose it as the default in Windows Settings."
                : "Registers VUERIQ for your user account so it appears in “Open with” and Default apps. No admin rights needed."
            }
          >
            <div className="flex gap-2">
              {assoc?.registered ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.unregisterAssociations();
                      showToast("File associations removed.");
                    } catch (e) {
                      showToast((e as { message: string }).message, "error");
                    }
                    setBusy(false);
                    refresh();
                  }}
                >
                  Unregister
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.registerAssociations();
                      showToast("Registered. Pick VUERIQ as default in Windows Settings.");
                    } catch (e) {
                      showToast((e as { message: string }).message, "error");
                    }
                    setBusy(false);
                    refresh();
                  }}
                >
                  Register
                </Button>
              )}
              <Button icon={<ExternalLink size={14} />} onClick={() => api.openDefaultAppsSettings()}>
                Default apps
              </Button>
            </div>
          </Row>
        </Group>

        <Group title="Storage">
          <Row
            label="Thumbnail cache"
            hint={stats ? `${stats.thumbnailFiles.toLocaleString()} thumbnails · ${formatBytes(stats.thumbnailBytes)}` : undefined}
          >
            <Button
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={async () => {
                const freed = await api.clearThumbnailCache();
                showToast(`Cleared ${formatBytes(freed)} of thumbnails.`);
                refresh();
              }}
            >
              Clear
            </Button>
          </Row>
          <Row label="Decoded images in memory" hint={stats ? `${stats.decodedImages} image(s) · ${formatBytes(stats.decodedBytes)} of ${formatBytes(stats.decodedBudget)}` : undefined}>
            <span />
          </Row>
        </Group>

        <Group title="Keyboard Shortcuts">
          <div className="grid grid-cols-2 gap-x-10 gap-y-2 py-3 text-[12.5px]">
            {SHORTCUTS.map(([k, d]) => (
              <div key={d} className="flex items-center justify-between gap-3">
                <span className="text-fg-muted">{d}</span>
                <span className="flex gap-1">
                  {k.split(" ").map((x) => (
                    <Kbd key={x}>{x}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Group>

        <Group title="About">
          <Row label="VUERIQ" hint="Premium universal image & video viewer.">
            <Button icon={<Info size={14} />} onClick={() => setAboutOpen(true)}>
              About VUERIQ
            </Button>
          </Row>
        </Group>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl O", "Open files"],
  ["← →", "Previous / next"],
  ["+ −", "Zoom in / out"],
  ["0", "Fit to window"],
  ["1", "Actual size (100%)"],
  ["R L", "Rotate right / left"],
  ["H V", "Flip horizontal / vertical"],
  ["F", "Full screen"],
  ["I", "Information panel"],
  ["S", "Toggle favorite"],
  ["Esc", "Exit full screen / back"],
  ["Space", "Play / pause video"],
  ["← →", "Seek video ±5 s"],
  [", .", "Previous / next frame"],
  ["[ ]", "Playback speed"],
  ["↑ ↓", "Volume"],
  ["M", "Mute"],
  ["PgUp PgDn", "Previous / next file (video)"],
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="mb-1 text-[11px] font-semibold tracking-[0.12em] text-fg-subtle uppercase">{title}</h2>
      <div className="divide-y divide-line rounded-xl border border-line bg-panel px-5">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-fg-subtle">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
