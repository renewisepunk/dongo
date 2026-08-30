import { CliCoreError } from "./errors.ts";
import type { BrowserOpener } from "./browser.ts";

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval?: number;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope: string[];
  expiresAt: number;
}

export interface DeviceAuthClock {
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface DeviceAuthorizationEvents {
  onVerification?(details: {
    verificationUriComplete: string;
    userCode: string;
    expiresAt: number;
    browserOpened: boolean;
    projectProposal?: FirstProjectProposal;
  }): void;
  onPending?(): void;
  onSlowDown?(intervalSeconds: number): void;
  onNetworkRetry?(message: string): void;
}

export interface FirstProjectProposal {
  name: string;
  repositoryUrl?: string;
  executionMode: "manual" | "autonomous";
}

export interface DeviceAuthorizationOptions {
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  resource: string;
  scopes: string[];
  fetch?: typeof globalThis.fetch;
  clock?: DeviceAuthClock;
  browserOpener: BrowserOpener;
  noBrowser?: boolean;
  projectProposal?: FirstProjectProposal;
  events?: DeviceAuthorizationEvents;
  signal?: AbortSignal;
}

const DEFAULT_CLOCK: DeviceAuthClock = {
  now: () => Date.now(),
  sleep: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      const timer = setTimeout(resolve, milliseconds);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("aborted"));
        },
        { once: true },
      );
    }),
};

function formBody(fields: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return body;
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => undefined);
  if (!value || typeof value !== "object") {
    throw new CliCoreError({
      code: "temporary_failure",
      message: `Authorization server returned an invalid HTTP ${response.status} response.`,
      retryable: response.status >= 500,
      exitCode: 5,
    });
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CliCoreError({ code: "validation", message: `Authorization response is missing ${name}.` });
  }
  return value;
}

function requirePositiveNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new CliCoreError({ code: "validation", message: `Authorization response has invalid ${name}.` });
  }
  return value;
}

function oauthError(body: Record<string, unknown>): { code: string } | undefined {
  if (typeof body.error !== "string") return undefined;
  const known = new Set([
    "access_denied",
    "authorization_pending",
    "expired_token",
    "invalid_client",
    "invalid_grant",
    "invalid_request",
    "slow_down",
    "temporarily_unavailable",
    "unauthorized_client",
  ]);
  return { code: known.has(body.error) ? body.error : "authorization_failed" };
}

function verificationUrl(value: unknown, name: string): string {
  const raw = requireString(value, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliCoreError({ code: "validation", message: `Authorization response has invalid ${name}.` });
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
    throw new CliCoreError({ code: "validation", message: `Authorization response has unsafe ${name}.` });
  }
  return url.toString();
}

function cancellationError(): CliCoreError {
  return new CliCoreError({ code: "cancelled", message: "Dongo authorization was cancelled. No credential was stored.", exitCode: 130 });
}

export class DeviceAuthorizationClient {
  readonly #options: DeviceAuthorizationOptions;
  readonly #fetch: typeof globalThis.fetch;
  readonly #clock: DeviceAuthClock;

  constructor(options: DeviceAuthorizationOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#clock = options.clock ?? DEFAULT_CLOCK;
  }

  async authorize(): Promise<OAuthTokenSet> {
    const request = await this.#requestDeviceAuthorization();
    if (this.#options.signal?.aborted) throw cancellationError();
    const expiresAt = this.#clock.now() + request.expires_in * 1_000;
    const verificationUriComplete = this.#verificationUriWithProposal(request.verification_uri_complete);
    const browserOpened = this.#options.noBrowser
      ? false
      : await this.#options.browserOpener.open(verificationUriComplete).catch(() => false);
    if (this.#options.signal?.aborted) throw cancellationError();
    this.#options.events?.onVerification?.({
      verificationUriComplete,
      userCode: request.user_code,
      expiresAt,
      browserOpened,
      projectProposal: this.#options.projectProposal,
    });
    return this.#poll(request, expiresAt);
  }

  #verificationUriWithProposal(value: string): string {
    const proposal = this.#options.projectProposal;
    if (!proposal) return value;
    const url = new URL(value);
    url.searchParams.set("project_name", proposal.name);
    if (proposal.repositoryUrl) url.searchParams.set("repository_url", proposal.repositoryUrl);
    url.searchParams.set("execution_mode", proposal.executionMode);
    return url.toString();
  }

  async #requestDeviceAuthorization(): Promise<DeviceAuthorizationResponse> {
    let response: Response;
    try {
      response = await this.#fetch(this.#options.deviceAuthorizationEndpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: formBody({
          client_id: this.#options.clientId,
          resource: this.#options.resource,
          scope: this.#options.scopes.join(" "),
        }),
        signal: this.#options.signal,
      });
    } catch (cause) {
      if (this.#options.signal?.aborted) throw cancellationError();
      throw new CliCoreError({
        code: "temporary_failure",
        message: "Could not start Dongo authorization.",
        retryable: true,
        exitCode: 5,
        cause,
      });
    }
    const body = await parseJson(response);
    const error = oauthError(body);
    if (!response.ok || error) {
      throw new CliCoreError({
        code: error?.code ?? "authorization_failed",
        message: error?.code === "invalid_client" ? "The Dongo CLI registration is invalid." : "Could not start Dongo authorization.",
        retryable: response.status >= 500 || response.status === 429,
        exitCode: response.status >= 500 ? 5 : 3,
      });
    }
    const baseVerificationUri = verificationUrl(body.verification_uri, "verification_uri");
    const completeVerificationUri = verificationUrl(body.verification_uri_complete, "verification_uri_complete");
    if (new URL(baseVerificationUri).origin !== new URL(completeVerificationUri).origin) {
      throw new CliCoreError({ code: "validation", message: "Authorization response verification origins do not match." });
    }
    return {
      device_code: requireString(body.device_code, "device_code"),
      user_code: requireString(body.user_code, "user_code"),
      verification_uri: baseVerificationUri,
      verification_uri_complete: completeVerificationUri,
      expires_in: requirePositiveNumber(body.expires_in, "expires_in"),
      interval: body.interval === undefined ? undefined : requirePositiveNumber(body.interval, "interval"),
    };
  }

  async #poll(request: DeviceAuthorizationResponse, expiresAt: number): Promise<OAuthTokenSet> {
    let intervalSeconds = request.interval ?? 5;
    while (this.#clock.now() < expiresAt) {
      try {
        await this.#clock.sleep(intervalSeconds * 1_000, this.#options.signal);
      } catch (error) {
        if (this.#options.signal?.aborted) throw cancellationError();
        throw error;
      }
      if (this.#clock.now() >= expiresAt) break;
      let response: Response;
      try {
        response = await this.#fetch(this.#options.tokenEndpoint, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
          body: formBody({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: request.device_code,
            client_id: this.#options.clientId,
            resource: this.#options.resource,
          }),
          signal: this.#options.signal,
        });
      } catch (error) {
        if (this.#options.signal?.aborted) throw cancellationError();
        this.#options.events?.onNetworkRetry?.("Authorization polling was interrupted; retrying until the request expires.");
        continue;
      }
      let body: Record<string, unknown>;
      try {
        body = await parseJson(response);
      } catch (error) {
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("retry-after"));
          intervalSeconds = Math.max(
            intervalSeconds + 5,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0,
          );
          this.#options.events?.onSlowDown?.(intervalSeconds);
          continue;
        }
        if (response.status >= 500) {
          this.#options.events?.onNetworkRetry?.("Authorization server is temporarily unavailable; retrying until the request expires.");
          continue;
        }
        throw error;
      }
      const error = oauthError(body);
      if (response.ok && !error) return this.#parseToken(body);
      if (response.status === 429 && error?.code !== "slow_down") {
        const retryAfter = Number(response.headers.get("retry-after"));
        intervalSeconds = Math.max(
          intervalSeconds + 5,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0,
        );
        this.#options.events?.onSlowDown?.(intervalSeconds);
        continue;
      }
      if (!error && response.status >= 500) {
        this.#options.events?.onNetworkRetry?.("Authorization server is temporarily unavailable; retrying until the request expires.");
        continue;
      }
      switch (error?.code) {
        case "authorization_pending":
          this.#options.events?.onPending?.();
          continue;
        case "slow_down":
          intervalSeconds += 5;
          this.#options.events?.onSlowDown?.(intervalSeconds);
          continue;
        case "temporarily_unavailable":
          continue;
        case "access_denied":
          throw new CliCoreError({
            code: "authorization_denied",
            message: "Dongo authorization was denied. No credential was stored.",
            exitCode: 3,
          });
        case "expired_token":
          throw new CliCoreError({
            code: "authorization_expired",
            message: "The Dongo authorization request expired. Run dongo connect again for a fresh link.",
            exitCode: 3,
          });
        default:
          throw new CliCoreError({
            code: error?.code ?? "authorization_failed",
            message: `Authorization token exchange failed with HTTP ${response.status}.`,
            retryable: response.status >= 500,
            exitCode: response.status >= 500 ? 5 : 3,
          });
      }
    }
    throw new CliCoreError({
      code: "authorization_expired",
      message: "The Dongo authorization request expired. Run dongo connect again for a fresh link.",
      exitCode: 3,
    });
  }

  #parseToken(body: Record<string, unknown>): OAuthTokenSet {
    const expiresIn = requirePositiveNumber(body.expires_in, "expires_in");
    return {
      accessToken: requireString(body.access_token, "access_token"),
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
      scope:
        typeof body.scope === "string"
          ? body.scope.split(/\s+/).filter(Boolean).sort()
          : [...this.#options.scopes].sort(),
      expiresAt: this.#clock.now() + expiresIn * 1_000,
    };
  }
}
