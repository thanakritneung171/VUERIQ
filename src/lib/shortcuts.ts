// Keyboard shortcut map for the viewer — a pure function so it can be unit-tested.

export type ShortcutAction =
  | { type: "close" }
  | { type: "exitFullscreen" }
  | { type: "toggleFullscreen" }
  | { type: "toggleInfo" }
  | { type: "toggleFavorite" }
  | { type: "step"; delta: number }
  | { type: "first" }
  | { type: "last" }
  // image
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "fit" }
  | { type: "actualSize" }
  | { type: "rotate"; dir: 1 | -1 }
  | { type: "flip"; axis: "h" | "v" }
  | { type: "pan"; dx: number; dy: number }
  // video
  | { type: "togglePlay" }
  | { type: "seek"; seconds: number }
  | { type: "seekStart" }
  | { type: "volume"; delta: number }
  | { type: "mute" }
  | { type: "frameStep"; dir: 1 | -1 }
  | { type: "speed"; dir: 1 | -1 | 0 };

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export function resolveShortcut(e: KeyInput, ctx: { isVideo: boolean; fullscreen: boolean }): ShortcutAction | null {
  const k = e.key;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const shift = !!e.shiftKey;
  if (e.altKey) return null;

  // Shared
  if (k === "Escape") return ctx.fullscreen ? { type: "exitFullscreen" } : { type: "close" };
  if (k === "F11" || (!ctrl && (k === "f" || k === "F"))) return { type: "toggleFullscreen" };
  if (!ctrl && (k === "i" || k === "I")) return { type: "toggleInfo" };
  if (!ctrl && (k === "s" || k === "S")) return { type: "toggleFavorite" };
  if (k === "PageDown" || (ctrl && k === "ArrowRight")) return { type: "step", delta: 1 };
  if (k === "PageUp" || (ctrl && k === "ArrowLeft")) return { type: "step", delta: -1 };

  if (ctx.isVideo) {
    switch (k) {
      case " ":
      case "k":
      case "K":
        return { type: "togglePlay" };
      case "ArrowRight":
        return { type: "seek", seconds: shift ? 30 : 5 };
      case "ArrowLeft":
        return { type: "seek", seconds: shift ? -30 : -5 };
      case "l":
      case "L":
        return { type: "seek", seconds: 10 };
      case "j":
      case "J":
        return { type: "seek", seconds: -10 };
      case "ArrowUp":
        return { type: "volume", delta: 5 };
      case "ArrowDown":
        return { type: "volume", delta: -5 };
      case "m":
      case "M":
        return { type: "mute" };
      case ".":
        return { type: "frameStep", dir: 1 };
      case ",":
        return { type: "frameStep", dir: -1 };
      case "]":
        return { type: "speed", dir: 1 };
      case "[":
        return { type: "speed", dir: -1 };
      case "Backspace":
        return { type: "speed", dir: 0 };
      case "Home":
        return { type: "seekStart" };
    }
    return null;
  }

  // Image
  if (shift && k === "ArrowLeft") return { type: "pan", dx: 80, dy: 0 };
  if (shift && k === "ArrowRight") return { type: "pan", dx: -80, dy: 0 };
  switch (k) {
    case "ArrowRight":
    case " ":
      return { type: "step", delta: 1 };
    case "ArrowLeft":
      return { type: "step", delta: -1 };
    case "Home":
      return { type: "first" };
    case "End":
      return { type: "last" };
    case "+":
    case "=":
      return { type: "zoomIn" };
    case "-":
    case "_":
      return { type: "zoomOut" };
    case "0":
    case "*":
      return { type: "fit" };
    case "1":
      return { type: "actualSize" };
    case "r":
    case "]":
      return { type: "rotate", dir: 1 };
    case "R":
    case "l":
    case "L":
    case "[":
      return { type: "rotate", dir: -1 };
    case "h":
    case "H":
      return { type: "flip", axis: "h" };
    case "v":
    case "V":
      return { type: "flip", axis: "v" };
    case "ArrowUp":
      return { type: "pan", dx: 0, dy: 80 };
    case "ArrowDown":
      return { type: "pan", dx: 0, dy: -80 };
  }
  return null;
}
