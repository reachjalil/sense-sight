/// <reference types="astro/client" />

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface D1Result {
  success: boolean;
  error?: string;
}

interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: {
    contentType?: string;
  };
  size: number;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Env {
  DB: D1Database;
  RUNPOD_BUNDLES?: R2Bucket;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  DEMO_SESSION_SECRET?: string;
  RUNPOD_API_KEY?: string;
  RUNPOD_ENDPOINT_ID?: string;
  RUNPOD_BUNDLE_TOKEN?: string;
  RUNPOD_BUNDLE_URI?: string;
  RUNPOD_BUNDLE_SHA256?: string;
  RUNPOD_BUNDLE_VOLUME_PATH?: string;
  RUNPOD_OUTPUT_PREFIX_URI?: string;
  RUNPOD_TRAIN_STEPS?: string;
  RUNPOD_QUALITY_PRESET?: "preview" | "balanced" | "research";
  RUNPOD_PARALLEL_SHARDS?: string;
  RUNPOD_WORKER_IMAGE_TAG?: string;
}

declare module "cloudflare:workers" {
  export const env: Env;
}
