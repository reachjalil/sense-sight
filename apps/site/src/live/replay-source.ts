/**
 * A client-side {@link FrameStreamSource} that replays a recorded RGB-D robot
 * dataset as if it were a live sensor stream. The replay clock runs here in
 * the browser (a self-rescheduling `setTimeout` stepping through keyframes) —
 * this is the seam a future server, Durable Object, or live-robot bridge can
 * re-implement behind the same interface without the console changing.
 */

import type {
  FrameStreamSource,
  ReplayFrame,
  ReplayHello,
  ReplayServerMessage,
  ReplaySourceEntry,
  ReplayTelemetry,
  Vec3,
} from "@sense-sight/replay-protocol";

interface WorldDoc {
  readonly keyframeCount: number;
  readonly pointTotal: number;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly sequence?: string;
  readonly splat?: { readonly file: string; readonly gaussianCount: number };
}

interface KeyframeDoc {
  readonly index: number;
  readonly timestamp: string;
  readonly position: Vec3;
  readonly quaternion: { x: number; y: number; z: number; w: number };
  readonly headingRad: number;
  readonly imageRel: string;
  readonly pointStart: number;
  readonly pointCount: number;
}

const MIN_TICK_MS = 30;
const MAX_TICK_MS = 2000;
/** Treat a keyframe delta larger than this (seconds) as a gap and fall back. */
const MAX_FRAME_DT_S = 5;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
const DEFAULT_TICK_HZ = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toArray(view: Float32Array | Uint8Array): number[] {
  // Plain arrays so the data crosses the FrameStreamSource boundary as the
  // protocol's `readonly number[]`, matching a future JSON/transport source.
  return Array.from(view);
}

export function createReplaySource(
  entry: ReplaySourceEntry
): FrameStreamSource {
  const presetPath = entry.presetPath ?? "/presets/corridor1-2";
  const tickHz = entry.suggestedReplayRateHz ?? DEFAULT_TICK_HZ;

  let world: WorldDoc | null = null;
  let keyframes: KeyframeDoc[] = [];
  let xyz: Float32Array = new Float32Array(0);
  let rgb: Uint8Array = new Uint8Array(0);
  let hello: ReplayHello | null = null;

  const subscribers = new Set<(msg: ReplayServerMessage) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cursor = 0; // next keyframe index to emit
  let playing = false;
  let speed = 1;
  let loop = false;
  let loaded: Promise<ReplayHello> | null = null;

  function emit(msg: ReplayServerMessage): void {
    for (const cb of subscribers) cb(msg);
  }

  function timestampSeconds(kf: KeyframeDoc | undefined): number {
    if (!kf) return Number.NaN;
    const value = Number.parseFloat(kf.timestamp);
    return Number.isFinite(value) ? value : Number.NaN;
  }

  /** Interval before emitting keyframe `i`, from the recorded inter-frame dt. */
  function intervalMs(i: number): number {
    const fallback = 1000 / tickHz / speed;
    if (i <= 0) return clamp(fallback, MIN_TICK_MS, MAX_TICK_MS);
    const prev = timestampSeconds(keyframes[i - 1]);
    const curr = timestampSeconds(keyframes[i]);
    const dt = curr - prev;
    if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_FRAME_DT_S) {
      return clamp(fallback, MIN_TICK_MS, MAX_TICK_MS);
    }
    return clamp((dt / speed) * 1000, MIN_TICK_MS, MAX_TICK_MS);
  }

  function buildFrame(i: number): ReplayFrame {
    const kf = keyframes[i];
    const start = kf.pointStart * 3;
    const end = (kf.pointStart + kf.pointCount) * 3;
    const keyframeCount = keyframes.length;
    return {
      index: kf.index,
      timestamp: kf.timestamp,
      position: kf.position,
      headingRad: kf.headingRad,
      progress: (i + 1) / keyframeCount,
      points: {
        xyz: toArray(xyz.subarray(start, end)),
        rgb: toArray(rgb.subarray(start, end)),
      },
      imageUrl: `${presetPath}/${kf.imageRel}`,
    };
  }

  function telemetry(i: number): ReplayTelemetry {
    const kf = keyframes[i] ?? keyframes[keyframes.length - 1];
    const keyframeCount = keyframes.length;
    return {
      index: kf?.index ?? 0,
      progress:
        keyframeCount > 0 ? Math.min(i + 1, keyframeCount) / keyframeCount : 0,
      position: kf?.position ?? { x: 0, y: 0, z: 0 },
      headingRad: kf?.headingRad ?? 0,
      playing,
      speed,
    };
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNext(): void {
    clearTimer();
    if (!playing) return;
    if (cursor >= keyframes.length) {
      if (loop) {
        cursor = 0;
        emit({ type: "reset" });
      } else {
        playing = false;
        emit({ type: "telemetry", snapshot: telemetry(keyframes.length - 1) });
        return;
      }
    }
    const wait = intervalMs(cursor);
    timer = setTimeout(tick, wait);
  }

  function tick(): void {
    timer = null;
    if (!playing) return;
    if (cursor >= keyframes.length) {
      scheduleNext();
      return;
    }
    const i = cursor;
    emit({ type: "frame", frame: buildFrame(i) });
    cursor = i + 1;
    scheduleNext();
  }

  async function load(): Promise<ReplayHello> {
    const [worldRes, keyframesRes, xyzRes, rgbRes] = await Promise.all([
      fetch(`${presetPath}/world.json`),
      fetch(`${presetPath}/keyframes.json`),
      fetch(`${presetPath}/points_xyz.f32`),
      fetch(`${presetPath}/points_rgb.u8`),
    ]);
    if (!worldRes.ok) throw new Error(`world.json ${worldRes.status}`);
    if (!keyframesRes.ok)
      throw new Error(`keyframes.json ${keyframesRes.status}`);
    if (!xyzRes.ok) throw new Error(`points_xyz.f32 ${xyzRes.status}`);
    if (!rgbRes.ok) throw new Error(`points_rgb.u8 ${rgbRes.status}`);

    world = (await worldRes.json()) as WorldDoc;
    keyframes = (await keyframesRes.json()) as KeyframeDoc[];
    xyz = new Float32Array(await xyzRes.arrayBuffer());
    rgb = new Uint8Array(await rgbRes.arrayBuffer());

    const keyframeCount = world.keyframeCount ?? keyframes.length;
    const splatCount = world.splat?.gaussianCount;
    hello = {
      sourceId: entry.id,
      sequence: world.sequence ?? entry.label,
      keyframeCount,
      pointTotal: world.pointTotal,
      bounds: world.bounds,
      tickHz,
      splatUrl: `${presetPath}/scene.splat`,
      splatCount,
    };
    return hello;
  }

  return {
    id: entry.id,

    hello(): Promise<ReplayHello> {
      if (!loaded) {
        loaded = load().then((resolved) => {
          // Announce the source and where the trained splat lives once loaded.
          emit({ type: "hello", hello: resolved });
          if (resolved.splatUrl && resolved.splatCount !== undefined) {
            emit({
              type: "gaussians",
              version: 1,
              splatUrl: resolved.splatUrl,
              gaussianCount: resolved.splatCount,
              keyframeRange: [0, resolved.keyframeCount],
            });
          }
          return resolved;
        });
      }
      return loaded;
    },

    play(): void {
      if (playing || keyframes.length === 0) {
        playing = keyframes.length > 0;
        return;
      }
      playing = true;
      scheduleNext();
    },

    pause(): void {
      playing = false;
      clearTimer();
    },

    setSpeed(next: number): void {
      speed = clamp(next, MIN_SPEED, MAX_SPEED);
      if (playing) scheduleNext();
    },

    setLoop(next: boolean): void {
      loop = next;
    },

    seek(target: number): void {
      if (keyframes.length === 0) return;
      const t = clamp(Math.floor(target), 0, keyframes.length - 1);
      clearTimer();
      cursor = t;
      emit({ type: "reset" });

      const kf = keyframes[t];
      const end = (kf.pointStart + kf.pointCount) * 3;
      const keyframeCount = keyframes.length;
      // One bulk frame rebuilds the revealed cloud to the seeked position.
      emit({
        type: "frame",
        frame: {
          index: kf.index,
          timestamp: kf.timestamp,
          position: kf.position,
          headingRad: kf.headingRad,
          progress: (t + 1) / keyframeCount,
          points: {
            xyz: toArray(xyz.subarray(0, end)),
            rgb: toArray(rgb.subarray(0, end)),
          },
          imageUrl: `${presetPath}/${kf.imageRel}`,
        },
      });
      // Continue playback from the keyframe *after* the seeked one.
      cursor = t + 1;
      if (playing) scheduleNext();
    },

    subscribe(onMessage: (msg: ReplayServerMessage) => void): () => void {
      subscribers.add(onMessage);
      return () => {
        subscribers.delete(onMessage);
      };
    },

    dispose(): void {
      playing = false;
      clearTimer();
      subscribers.clear();
    },
  };
}
