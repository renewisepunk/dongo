import type {
  ApiResult,
  DomainErrorCode,
  OperationInput,
  OperationMap,
  OperationName,
  OperationOutput,
  Overview,
  SessionStart,
  SyncSnapshot,
} from "@dongo/contracts";

export type {
  ApiResult,
  DomainErrorCode,
  OperationInput,
  OperationMap,
  OperationName,
  OperationOutput,
  Overview,
  SessionStart,
  SyncSnapshot,
};

// Stable aliases retained for CLI consumers while canonical shapes live in
// @dongo/contracts.
export type ApiErrorCode = DomainErrorCode | string;
export type SessionStartData = SessionStart;
export type OverviewData = Overview;
export type SyncSnapshotData = SyncSnapshot;

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface ClientClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface ClientOptions {
  baseUrl: string;
  tokenProvider: AccessTokenProvider;
  fetch?: typeof globalThis.fetch;
  clock?: ClientClock;
  random?: () => number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
}

export interface CallOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}
