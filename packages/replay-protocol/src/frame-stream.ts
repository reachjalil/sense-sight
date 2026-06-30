import type { ReplayHello, ReplayServerMessage } from "./protocol";

/**
 * The seam between the console UI and a replay/live source. A browser timer
 * stepping through recorded keyframes implements this today; a server,
 * Durable Object, or live-robot WebRTC bridge can implement the same surface
 * later without the consumer changing.
 */
export interface FrameStreamSource {
  readonly id: string;
  hello(): Promise<ReplayHello>;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  seek(frameIndex: number): void;
  setLoop(loop: boolean): void;
  subscribe(onMessage: (msg: ReplayServerMessage) => void): () => void;
  dispose(): void;
}
