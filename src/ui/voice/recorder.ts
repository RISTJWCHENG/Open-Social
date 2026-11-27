/**
 * Records a voice message from the microphone: Opus at about 32 kbit/s
 * (WebM in Chrome, Edge and Firefox; MP4 in Safari), with a live level meter
 * and the waveform the message carries. Pause and resume; stops by itself at
 * the length limit.
 */
import { MAX_VOICE_MS } from '../../core/delivery/realMessaging';

export const WAVE_BARS = 48;
const LEVEL_EVERY_MS = 80;

export interface Recording {
  blob: Blob;
  mime: string;
  ms: number;
  /** Base64 of WAVE_BARS amplitude bytes. */
  wave: string;
}

export type RecorderState = 'recording' | 'paused' | 'stopped';

/** Container and codec this browser records in (Opus where possible). */
export function recordingMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/** Why recording can't start, in words for the user. */
export function microphoneError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is blocked. Allow it for this site in your browser, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return 'Recording could not start.';
}

/** Downsamples levels (0..1) to `bars` bytes, scaled so the loudest bar is full height. */
export function waveform(levels: number[], bars = WAVE_BARS): Uint8Array {
  const out = new Uint8Array(bars);
  if (levels.length === 0) return out;
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((i * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / bars));
    let peak = 0;
    for (let j = from; j < to && j < levels.length; j++) peak = Math.max(peak, levels[j]!);
    peaks.push(peak);
  }
  const max = Math.max(...peaks, 0.02);
  peaks.forEach((p, i) => (out[i] = Math.round(Math.min(1, p / max) * 255)));
  return out;
}

export class VoiceRecorder {
  state: RecorderState = 'recording';
  /** Recent levels for the live meter (0..1). */
  levels: number[] = [];
  private all: number[] = [];
  private chunks: Blob[] = [];
  private recorder: MediaRecorder;
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private timer: ReturnType<typeof setInterval>;
  private elapsed = 0;
  private since = performance.now();
  private stopped: Promise<void>;

  private constructor(
    private stream: MediaStream,
    readonly mime: string,
    private onChange: () => void,
  ) {
    this.recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.stopped = new Promise((resolve) => (this.recorder.onstop = () => resolve()));
    this.recorder.start(250);
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);
    const buf = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => {
      if (this.state !== 'recording') return;
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      this.all.push(level);
      this.levels = [...this.levels.slice(-59), level];
      if (this.ms() >= MAX_VOICE_MS) void this.finish();
      this.onChange();
    }, LEVEL_EVERY_MS);
  }

  /** Asks for the microphone (the browser may prompt) and starts recording. */
  static async start(onChange: () => void): Promise<VoiceRecorder> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return new VoiceRecorder(stream, recordingMime(), onChange);
  }

  /** Recorded length so far, without paused time. */
  ms(): number {
    return Math.min(MAX_VOICE_MS, this.elapsed + (this.state === 'recording' ? performance.now() - this.since : 0));
  }

  pause() {
    if (this.state !== 'recording') return;
    this.elapsed += performance.now() - this.since;
    this.recorder.pause();
    this.state = 'paused';
    this.onChange();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.since = performance.now();
    this.recorder.resume();
    this.state = 'recording';
    this.onChange();
  }

  /** Stops recording and keeps it (to send). */
  private async finish(): Promise<void> {
    if (this.state === 'recording') this.elapsed += performance.now() - this.since;
    if (this.state !== 'stopped') {
      this.state = 'stopped';
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.release();
      this.onChange();
    }
    await this.stopped;
  }

  /**
   * What has been recorded so far, to listen to while paused (or stopped).
   * Flushes the recorder's buffer first so the last moments are included.
   */
  async soFar(): Promise<Blob> {
    if (this.recorder.state === 'paused') {
      await new Promise<void>((resolve) => {
        const prev = this.recorder.ondataavailable;
        this.recorder.ondataavailable = (e) => {
          prev?.call(this.recorder, e);
          this.recorder.ondataavailable = prev;
          resolve();
        };
        this.recorder.requestData();
      });
    } else if (this.state === 'stopped') {
      await this.stopped;
    }
    return new Blob(this.chunks, { type: (this.recorder.mimeType || this.mime || 'audio/webm').split(';')[0] });
  }

  /** Waveform of everything recorded so far, as `bars` values 0..1. */
  bars(bars: number): number[] {
    return [...waveform(this.all, bars)].map((b) => b / 255);
  }

  /** The finished recording. */
  async done(): Promise<Recording> {
    await this.finish();
    const mime = (this.recorder.mimeType || this.mime || 'audio/webm').split(';')[0]!;
    const wave = btoa(String.fromCharCode(...waveform(this.all)));
    return { blob: new Blob(this.chunks, { type: mime }), mime, ms: Math.max(1, Math.round(this.elapsed)), wave };
  }

  /** Stops and throws the recording away. */
  cancel() {
    if (this.state !== 'stopped' && this.recorder.state !== 'inactive') this.recorder.stop();
    this.state = 'stopped';
    this.chunks = [];
    this.release();
  }

  private release() {
    clearInterval(this.timer);
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => undefined);
  }
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
