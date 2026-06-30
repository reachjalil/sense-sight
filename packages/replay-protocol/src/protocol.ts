/**
 * @sense-sight/replay-protocol — wire contracts for the replayed-sensor-stream
 * demo. Defines the messages a `FrameStreamSource` emits/accepts so the same
 * shapes can later back a server, Durable Object, or live-robot source.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ReplayFrame {
  readonly index: number;
  readonly timestamp: string;
  readonly position: Vec3;
  readonly headingRad: number;
  /** 0..1 through the sequence. */
  readonly progress: number;
  readonly points: {
    readonly xyz: readonly number[];
    readonly rgb: readonly number[];
  };
  /** Real camera frame URL. */
  readonly imageUrl?: string;
  readonly speedMps?: number;
}

export interface ReplayHello {
  readonly sourceId: string;
  readonly sequence: string;
  readonly keyframeCount: number;
  readonly pointTotal: number;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly tickHz: number;
  readonly splatUrl?: string;
  readonly splatCount?: number;
}

export interface ReplayTelemetry {
  readonly index: number;
  readonly progress: number;
  readonly position: Vec3;
  readonly headingRad: number;
  readonly playing: boolean;
  readonly speed: number;
}

export type ReplayServerMessage =
  | { readonly type: "hello"; readonly hello: ReplayHello }
  | { readonly type: "frame"; readonly frame: ReplayFrame }
  | {
      readonly type: "gaussians";
      readonly version: number;
      readonly splatUrl: string;
      readonly gaussianCount: number;
      readonly keyframeRange?: readonly [number, number];
    }
  | { readonly type: "telemetry"; readonly snapshot: ReplayTelemetry }
  | { readonly type: "reset" };

export type ReplayClientMessage =
  | { readonly type: "play" }
  | { readonly type: "pause" }
  | { readonly type: "setSpeed"; readonly speed: number }
  | { readonly type: "seek"; readonly frameIndex: number }
  | { readonly type: "setLoop"; readonly loop: boolean };
