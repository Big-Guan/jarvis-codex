export function clampLevel(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function smoothValue(current, target, factor) {
  return current + (target - current) * clampLevel(factor);
}
