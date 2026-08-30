import { chmod, lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import type { AccessTokenProvider } from "../../client/src/index.ts";
import { CliCoreError } from "./errors.ts";
import type { SecretStore } from "./secret-store.ts";

export interface StoredCredential {
  schemaVersion: 1;
  clientId: string;
  issuer: string;
  resource: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
}

export interface CredentialStatus {
  source: "environment" | "secure-store" | "none";
  store: string;
  authenticated: boolean;
  issuer?: string;
  resource?: string;
  scopes: string[];
  accessTokenExpiresAt?: number;
  refreshAvailable: boolean;
}

export interface TokenManagerOptions {
  profile: string;
  store: SecretStore;
  lockDirectory: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function parseCredential(value: string): StoredCredential {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new CliCoreError({ code: "authentication_required", message: "Stored Dongo credentials are corrupted. Log out and reconnect." });
  }
  if (record.schemaVersion !== 1 || typeof record.clientId !== "string" || typeof record.issuer !== "string") {
    throw new CliCoreError({ code: "authentication_required", message: "Stored Dongo credentials use an unsupported format." });
  }
  return {
    schemaVersion: 1,
    clientId: record.clientId,
    issuer: record.issuer,
    resource: typeof record.resource === "string" ? record.resource : "",
    tokenEndpoint: typeof record.tokenEndpoint === "string" ? record.tokenEndpoint : "",
    revocationEndpoint: typeof record.revocationEndpoint === "string" ? record.revocationEndpoint : "",
    accessToken: typeof record.accessToken === "string" ? record.accessToken : undefined,
    accessTokenExpiresAt: typeof record.accessTokenExpiresAt === "number" ? record.accessTokenExpiresAt : undefined,
    refreshToken: typeof record.refreshToken === "string" ? record.refreshToken : undefined,
    tokenType: typeof record.tokenType === "string" ? record.tokenType : "Bearer",
    scopes: Array.isArray(record.scopes) ? record.scopes.filter((scope): scope is string => typeof scope === "string").sort() : [],
  };
}

function oauthBody(value: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) body.set(key, item);
  return body;
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => undefined);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function refreshErrorCode(value: unknown): "invalid_grant" | "refresh_failed" {
  return value === "invalid_grant" ? "invalid_grant" : "refresh_failed";
}

async function withFileLock<T>(
  lockFile: string,
  action: () => Promise<T>,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockFile, "wx", 0o600);
      try {
        return await action();
      } finally {
        await handle.close();
        await rm(lockFile, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await lstat(lockFile);
        if (info.isSymbolicLink() || !info.isFile()) {
          throw new CliCoreError({ code: "unsafe_path", message: "The Dongo refresh lock path is unsafe." });
        }
        if (now() - info.mtimeMs > 30_000) await rm(lockFile, { force: true });
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      await sleep(50);
    }
  }
  throw new CliCoreError({
    code: "temporary_failure",
    message: "Another Dongo command is refreshing authorization. Retry shortly.",
    retryable: true,
    exitCode: 5,
  });
}

async function prepareLockDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new CliCoreError({ code: "unsafe_path", message: "The Dongo refresh lock directory is unsafe." });
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new CliCoreError({ code: "unsafe_path", message: "The Dongo refresh lock directory is owned by another user." });
  }
  await chmod(directory, 0o700);
}

export class TokenManager implements AccessTokenProvider {
  readonly #profile: string;
  readonly #store: SecretStore;
  readonly #lockFile: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: TokenManagerOptions) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(options.profile)) {
      throw new CliCoreError({ code: "validation", message: "The Dongo credential profile is invalid." });
    }
    this.#profile = options.profile;
    this.#store = options.store;
    this.#lockFile = path.join(options.lockDirectory, `.refresh-${options.profile}.lock`);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async save(credential: StoredCredential): Promise<void> {
    await this.#store.set(this.#profile, JSON.stringify({ ...credential, scopes: [...credential.scopes].sort() }));
  }

  async load(): Promise<StoredCredential | undefined> {
    const value = await this.#store.get(this.#profile);
    return value === undefined ? undefined : parseCredential(value);
  }

  async status(): Promise<CredentialStatus> {
    if (process.env.DONGO_TOKEN) {
      return {
        source: "environment",
        store: "environment",
        authenticated: true,
        scopes: [],
        refreshAvailable: false,
      };
    }
    const credential = await this.load();
    return credential
      ? {
          source: "secure-store",
          store: this.#store.kind,
          authenticated: Boolean(credential.refreshToken || credential.accessToken),
          issuer: credential.issuer,
          resource: credential.resource,
          scopes: credential.scopes,
          accessTokenExpiresAt: credential.accessTokenExpiresAt,
          refreshAvailable: Boolean(credential.refreshToken),
        }
      : { source: "none", store: this.#store.kind, authenticated: false, scopes: [], refreshAvailable: false };
  }

  async getAccessToken(): Promise<string> {
    const environmentToken = process.env.DONGO_TOKEN;
    if (environmentToken) return environmentToken;
    const credential = await this.load();
    if (!credential) throw this.#authenticationRequired();
    if (credential.accessToken && (credential.accessTokenExpiresAt ?? 0) > this.#now() + 60_000) return credential.accessToken;
    if (!credential.refreshToken) {
      if (credential.accessToken && (credential.accessTokenExpiresAt ?? 0) > this.#now()) return credential.accessToken;
      throw this.#authenticationRequired();
    }

    await prepareLockDirectory(path.dirname(this.#lockFile));
    return withFileLock(
      this.#lockFile,
      async () => {
        const latest = await this.load();
        if (!latest) throw this.#authenticationRequired();
        if (latest.accessToken && (latest.accessTokenExpiresAt ?? 0) > this.#now() + 60_000) return latest.accessToken;
        return this.#refresh(latest);
      },
      this.#now,
      this.#sleep,
    );
  }

  async logout(): Promise<void> {
    if (process.env.DONGO_TOKEN) {
      throw new CliCoreError({
        code: "validation",
        message: "DONGO_TOKEN is an externally managed CI/service credential and cannot be revoked by dongo auth logout.",
        exitCode: 2,
      });
    }
    const credential = await this.load();
    if (!credential) return;
    const token = credential.refreshToken ?? credential.accessToken;
    if (token && credential.revocationEndpoint) {
      let response: Response;
      try {
        response = await this.#fetch(credential.revocationEndpoint, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
          body: oauthBody({
            token,
            token_type_hint: credential.refreshToken ? "refresh_token" : "access_token",
            client_id: credential.clientId,
          }),
        });
      } catch (cause) {
        throw new CliCoreError({
          code: "temporary_failure",
          message: "Could not revoke the Dongo grant. Local credentials were retained so logout can be retried.",
          retryable: true,
          exitCode: 5,
          cause,
        });
      }
      if (!response.ok) {
        throw new CliCoreError({
          code: "temporary_failure",
          message: `Dongo grant revocation failed with HTTP ${response.status}. Local credentials were retained.`,
          retryable: response.status >= 500 || response.status === 429,
          exitCode: 5,
        });
      }
    }
    await this.#store.delete(this.#profile);
  }

  async #refresh(credential: StoredCredential): Promise<string> {
    let response: Response;
    try {
      response = await this.#fetch(credential.tokenEndpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: oauthBody({
          grant_type: "refresh_token",
          refresh_token: credential.refreshToken ?? "",
          client_id: credential.clientId,
          resource: credential.resource,
        }),
      });
    } catch (cause) {
      throw new CliCoreError({
        code: "temporary_failure",
        message: "Could not refresh Dongo authorization.",
        retryable: true,
        exitCode: 5,
        cause,
      });
    }
    const body = await readResponse(response);
    if (!response.ok || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      const code = refreshErrorCode(body.error);
      throw new CliCoreError({
        code: code === "invalid_grant" ? "authentication_required" : code,
        message:
          code === "invalid_grant"
            ? "Dongo authorization is no longer valid. Run dongo connect again."
            : "Could not refresh Dongo authorization.",
        retryable: response.status >= 500 || response.status === 429,
        exitCode: code === "invalid_grant" ? 3 : 5,
      });
    }
    const next: StoredCredential = {
      ...credential,
      accessToken: body.access_token,
      accessTokenExpiresAt: this.#now() + body.expires_in * 1_000,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : credential.refreshToken,
      tokenType: typeof body.token_type === "string" ? body.token_type : credential.tokenType,
      scopes:
        typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean).sort() : credential.scopes,
    };
    await this.save(next);
    return next.accessToken ?? "";
  }

  #authenticationRequired(): CliCoreError {
    return new CliCoreError({
      code: "authentication_required",
      message: "This repository is not authenticated. Run dongo connect.",
      exitCode: 3,
    });
  }
}
