// Keyboard shortcuts as shown to the user (Settings and the "?" dialog).
// The viewer's actual key handling lives in shortcuts.ts.

export interface ShortcutGroup {
  title: string;
  items: [keys: string, description: string][];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    items: [
      ["Ctrl O", "Open files"],
      ["Ctrl Z", "Undo delete / move"],
      ["?", "Show keyboard shortcuts"],
    ],
  },
  {
    title: "Gallery",
    items: [
      ["Enter", "Open selected"],
      ["Ctrl A", "Select all"],
      ["Shift ←→↑↓", "Extend selection"],
      ["Del", "Move selection to Recycle Bin"],
      ["F5", "Refresh folder"],
      ["Esc", "Clear selection"],
    ],
  },
  {
    title: "Viewer",
    items: [
      ["← →", "Previous / next"],
      ["Home End", "First / last"],
      ["+ −", "Zoom in / out"],
      ["0", "Fit to window"],
      ["1", "Actual size (100%)"],
      ["R L", "Rotate right / left"],
      ["H V", "Flip horizontal / vertical"],
      ["F", "Full screen"],
      ["I", "Information panel"],
      ["S", "Add / remove favorite"],
      ["Del", "Move to Recycle Bin"],
      ["Esc", "Exit full screen / back"],
    ],
  },
  {
    title: "Video",
    items: [
      ["Space", "Play / pause"],
      ["← →", "Seek ±5 s (Shift ±30 s)"],
      [", .", "Previous / next frame"],
      ["[ ]", "Playback speed"],
      ["↑ ↓", "Volume"],
      ["M", "Mute"],
      ["PgUp PgDn", "Previous / next file"],
    ],
  },
];
