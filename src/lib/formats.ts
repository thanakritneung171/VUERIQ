// Extension lists. The authoritative list lives in src-tauri/src/formats.rs;
// these are used for drag & drop filtering and dialog filters only.

export const IMAGE_EXTS = [
  "jpg", "jpeg", "jpe", "jfif", "png", "apng", "webp", "gif", "bmp", "dib", "ico", "cur",
  "tif", "tiff", "svg", "heic", "heif", "hif", "heics", "avif", "jxl", "tga", "qoi", "pnm", "pbm", "pgm", "ppm", "hdr", "exr",
  "cr2", "cr3", "nef", "nrw", "arw", "srf", "sr2", "dng", "orf", "raf", "rw2", "pef", "srw", "erf", "3fr", "iiq", "mrw", "kdc", "dcr", "mos",
];

export const VIDEO_EXTS = [
  "mp4", "m4v", "mov", "qt", "mkv", "webm", "avi", "wmv", "asf", "mpeg", "mpg", "mpe", "m2v",
  "3gp", "3g2", "ts", "m2ts", "mts", "flv", "ogv", "vob", "f4v", "divx",
];

const imageSet = new Set(IMAGE_EXTS);
const videoSet = new Set(VIDEO_EXTS);

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function kindOf(path: string): "image" | "video" | null {
  const e = extOf(path);
  if (imageSet.has(e)) return "image";
  if (videoSet.has(e)) return "video";
  return null;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (i <= 0) return path;
  const d = path.slice(0, i);
  return /^[A-Za-z]:$/.test(d) ? d + "\\" : d;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}
