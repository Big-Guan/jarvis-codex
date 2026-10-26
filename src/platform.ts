import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Config, Skin, builtinSkin, normalizeConfig, Snapshot } from "./domain";
export const native = "__TAURI_INTERNALS__" in window;
const events = new EventTarget();
export async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    throw new Error(
      "此操作需要运行 Jarvis Next 原生应用。浏览器只提供配置与机甲预览。",
    );
  return invoke<T>(command, args);
}
export async function on<T>(name: string, callback: (payload: T) => void) {
  if (native) return listen<T>(name, (e) => callback(e.payload));
  const f = (e: Event) => callback((e as CustomEvent<T>).detail);
  events.addEventListener(name, f);
  return () => events.removeEventListener(name, f);
}
export async function publish(snapshot: Snapshot) {
  if (native) await invoke("publish_snapshot", { snapshot });
  else
    events.dispatchEvent(
      new CustomEvent("next-state", { detail: structuredClone(snapshot) }),
    );
}
export async function action(action: string) {
  if (native) await invoke("dispatch_action", { action });
  else events.dispatchEvent(new CustomEvent("next-action", { detail: action }));
}
export async function loadConfig() {
  return normalizeConfig(
    native
      ? await invoke("load_settings")
      : JSON.parse(localStorage.getItem("jarvis-next.settings") ?? "{}"),
  );
}
export async function saveConfig(config: Config) {
  if (native) await invoke("save_settings", { config });
  else localStorage.setItem("jarvis-next.settings", JSON.stringify(config));
}
export async function loadSkins(): Promise<Skin[]> {
  return [builtinSkin, ...(native ? await invoke<Skin[]>("list_skins") : [])];
}
export function skinURL(skin: Skin) {
  return skin.path.startsWith("/") && skin.id !== "nano-armor" && native
    ? convertFileSrc(skin.path)
    : skin.path;
}
