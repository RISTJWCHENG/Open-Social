/**
 * Call tones made with Web Audio (no audio files): a ring for incoming calls
 * and a softer ringback while calling. Browsers may keep audio silent until
 * the page has been interacted with; that is harmless.
 */
export type Tone = 'ring' | 'ringback';

export function startTone(tone: Tone): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => undefined;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return () => undefined;
  }
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const freqs = tone === 'ring' ? [880, 660] : [440, 480];
  const oscs = freqs.map((f) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.connect(gain);
    o.start();
    return o;
  });
  const level = tone === 'ring' ? 0.12 : 0.05;
  // Ring: two short bursts every 3 s. Ringback: 1 s on, 3 s off.
  const pattern: [number, number][] =
    tone === 'ring'
      ? [
          [0, 0.4],
          [0.6, 1.0],
        ]
      : [[0, 1]];
  const period = tone === 'ring' ? 3 : 4;
  const schedule = () => {
    const now = ctx.currentTime;
    for (let k = 0; k < 4; k++) {
      for (const [on, off] of pattern) {
        gain.gain.setValueAtTime(level, now + k * period + on);
        gain.gain.setValueAtTime(0, now + k * period + off);
      }
    }
  };
  schedule();
  const timer = setInterval(schedule, period * 4 * 1000);
  return () => {
    clearInterval(timer);
    oscs.forEach((o) => o.stop());
    void ctx.close().catch(() => undefined);
  };
}
