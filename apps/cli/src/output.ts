import { CliCoreError } from "@dongo/cli-core";
import { DongoClientError } from "@dongo/client";

export interface OutputWriter {
  stdout(value: string): void;
  stderr(value: string): void;
}

export const processOutput: OutputWriter = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export function writeJson(writer: OutputWriter, value: unknown): void {
  writer.stdout(`${JSON.stringify(value)}\n`);
}

export function errorResult(error: unknown, command: string): {
  exitCode: number;
  result: { ok: false; command: string; error: { code: string; message: string; retryable: boolean; details?: unknown }; recovery?: { idempotencyKey: string } };
} {
  if (error instanceof CliCoreError) {
    const message = error.code === "already_resolved" ? "Attention already resolved." : error.message;
    return {
      exitCode: error.code === "already_resolved" ? 6 : error.exitCode,
      result: {
        ok: false,
        command,
        error: { code: error.code, message, retryable: error.code === "already_resolved" ? false : error.retryable, details: error.details },
      },
    };
  }
  if (error instanceof DongoClientError) {
    const conflict = error.code.includes("conflict") || [
      "lease_expired",
      "already_resolved",
      "parallel_execution_unavailable",
      "concurrency_limit",
      "session_work_limit",
    ].includes(error.code);
    const message = error.code === "already_resolved" ? "Attention already resolved." : error.message;
    return {
      exitCode:
        error.code === "cancelled"
          ? 130
          : error.code === "unauthorized"
            ? 3
            : error.code === "insufficient_scope"
              ? 4
              : conflict
                ? 6
                : error.retryable
                  ? 5
                  : 1,
      result: {
        ok: false,
        command,
        error: {
          code: error.code,
          message,
          retryable: error.code === "already_resolved" ? false : error.retryable,
          details: error.details ?? (error.requestId ? { requestId: error.requestId } : undefined),
        },
      },
    };
  }
  return {
    exitCode: 1,
    result: {
      ok: false,
      command,
      error: { code: "internal", message: "Unexpected CLI failure.", retryable: false },
    },
  };
}
