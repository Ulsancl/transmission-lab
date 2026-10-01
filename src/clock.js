// Visible elapsed time is advanced in small model steps, independent of render FPS.
export function advanceClock(seconds, step) {
  if (!Number.isFinite(seconds) || seconds <= 0) return { advanced: 0, stalled: false };
  if (seconds > 1) return { advanced: 0, stalled: true };
  const count = Math.ceil(seconds / 0.05);
  const dt = seconds / count;
  let advanced = 0;
  for (let i = 0; i < count; i++) {
    advanced += dt;
    if (step(dt) === false) break;
  }
  return { advanced, stalled: false };
}
