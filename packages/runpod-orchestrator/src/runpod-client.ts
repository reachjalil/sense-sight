/**
 * Typed fetch-based client against RunPod's Serverless REST API.
 *
 * This is application code (a bundling/orchestrator service or worker), not
 * an agent-session tool — it must run standalone with only `fetch` and an API
 * key, so it intentionally does not depend on any MCP RunPod integration.
 *
 * NOTE: the endpoint paths below (`/run`, `/runsync`, `/status/:id`,
 * `/cancel/:id`, `/retry/:id`, `/stream/:id`, `/health`) should be
 * reverified against RunPod's current API docs before production use —
 * RunPod has changed Serverless API shapes across releases.
 */

import type { WorkerInput, WorkerOutput } from "./job-types";

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

export type RunPodJobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export interface RunPodJobStatusResponse {
  readonly id: string;
  readonly status: RunPodJobStatus;
  readonly output?: WorkerOutput;
  readonly error?: string;
}

export interface RunPodExecutionPolicy {
  readonly executionTimeout?: number;
  readonly lowPriority?: boolean;
  readonly ttl?: number;
}

export interface RunPodRunOptions {
  readonly webhook?: string;
  readonly policy?: RunPodExecutionPolicy;
}

export interface RunPodEndpointHealth {
  readonly jobs: {
    readonly completed: number;
    readonly failed: number;
    readonly inProgress: number;
    readonly inQueue: number;
    readonly retried: number;
  };
  readonly workers: {
    readonly idle: number;
    readonly initializing: number;
    readonly ready: number;
    readonly running: number;
    readonly throttled: number;
    readonly unhealthy: number;
  };
}

const TERMINAL_STATUSES: ReadonlySet<RunPodJobStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);

export interface RunPodClientOptions {
  readonly apiKey: string;
  /** Override for testing; defaults to RunPod's public API base. */
  readonly baseUrl?: string;
  /** Polling interval (ms) used by streamJob. Defaults to 1500. */
  readonly pollIntervalMs?: number;
}

export class RunPodClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;

  constructor(options: RunPodClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? RUNPOD_API_BASE;
    this.pollIntervalMs = options.pollIntervalMs ?? 1500;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `RunPod request failed: ${response.status} ${response.statusText} ${body}`
      );
    }
    return (await response.json()) as T;
  }

  /** POST /v2/{endpointId}/run — submit an async job. */
  async runEndpoint(
    endpointId: string,
    input: WorkerInput,
    opts?: RunPodRunOptions
  ): Promise<{ id: string; status: RunPodJobStatus }> {
    return this.request(`/${endpointId}/run`, {
      method: "POST",
      body: JSON.stringify({
        input,
        webhook: opts?.webhook,
        policy: opts?.policy,
      }),
    });
  }

  /** POST /v2/{endpointId}/runsync — submit and block for the result. */
  async runSyncEndpoint(
    endpointId: string,
    input: WorkerInput,
    opts?: RunPodRunOptions
  ): Promise<RunPodJobStatusResponse> {
    return this.request(`/${endpointId}/runsync`, {
      method: "POST",
      body: JSON.stringify({
        input,
        webhook: opts?.webhook,
        policy: opts?.policy,
      }),
    });
  }

  /** GET /v2/{endpointId}/status/{jobId} */
  async getJobStatus(
    endpointId: string,
    jobId: string
  ): Promise<RunPodJobStatusResponse> {
    return this.request(`/${endpointId}/status/${jobId}`, { method: "GET" });
  }

  /** POST /v2/{endpointId}/cancel/{jobId} */
  async cancelJob(
    endpointId: string,
    jobId: string
  ): Promise<RunPodJobStatusResponse> {
    return this.request(`/${endpointId}/cancel/${jobId}`, { method: "POST" });
  }

  /** POST /v2/{endpointId}/retry/{jobId} */
  async retryJob(
    endpointId: string,
    jobId: string
  ): Promise<RunPodJobStatusResponse> {
    return this.request(`/${endpointId}/retry/${jobId}`, { method: "POST" });
  }

  /**
   * GET /v2/{endpointId}/stream/{jobId} — poll until a terminal status,
   * yielding each chunk seen along the way (including the final one).
   */
  async *streamJob(
    endpointId: string,
    jobId: string
  ): AsyncGenerator<RunPodJobStatusResponse, void, void> {
    while (true) {
      const chunk = await this.request<RunPodJobStatusResponse>(
        `/${endpointId}/stream/${jobId}`,
        { method: "GET" }
      );
      yield chunk;
      if (TERMINAL_STATUSES.has(chunk.status)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  /** GET /v2/{endpointId}/health */
  async endpointHealth(endpointId: string): Promise<RunPodEndpointHealth> {
    return this.request(`/${endpointId}/health`, { method: "GET" });
  }
}
