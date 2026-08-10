export type SettingsCommand =
  | { kind: "open-settings" | "close-settings" | "open-studio" | "close-studio" | "show-status" | "show-help" | "reset-studio" }
  | { kind: "set-gesture" | "set-autostart"; enabled: boolean }
  | { kind: "set-language"; language: "zh" | "en" }
  | { kind: "set-voice"; voice: string }
  | { kind: "set-wake-phrase"; value: string }
  | { kind: "set-workspace"; path: string }
  | { kind: "set-permission"; mode: "safe" | "auto" | "full" }
  | { kind: "set-theme"; theme: "quantum" | "reactor" | "synthwave" | "matrix" | "arctic" }
  | { kind: "set-layout"; layout: "balanced" | "focus" | "command" }
  | { kind: "set-intensity" | "set-avatar-scale"; value: number }
  | { kind: "set-callsign" | "set-subtitle"; value: string }
  | { kind: "set-module"; module: "workers" | "dialogue" | "wave" | "compact"; enabled: boolean };

export function parseSettingsCommand(input: string): SettingsCommand | null;
