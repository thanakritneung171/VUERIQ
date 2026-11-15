import { open } from "@tauri-apps/plugin-dialog";
import { IMAGE_EXTS, VIDEO_EXTS } from "./formats";

export async function pickFiles(): Promise<string[]> {
  const res = await open({
    multiple: true,
    directory: false,
    title: "Open media — VUERIQ",
    filters: [
      { name: "All supported media", extensions: [...IMAGE_EXTS, ...VIDEO_EXTS] },
      { name: "Images", extensions: IMAGE_EXTS },
      { name: "Videos", extensions: VIDEO_EXTS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export async function pickFolder(): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, title: "Browse folder — VUERIQ" });
  if (!res) return null;
  return Array.isArray(res) ? (res[0] ?? null) : res;
}
