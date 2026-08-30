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

export function errorResult(error: unknown): {
  exitCode: number;
  result: { ok: false; error: { code: string; message: string; retryable: boolean; details?: unknown } };
} {
  if (error instanceof CliCoreError) {
    return {
      exitCode: error.exitCode,
      result: {
        ok: false,
        error: { code: error.code, message: error.message, retryable: error.retryable, details: error.details },
      },
    };
  }
  if (error instanceof DongoClientError) {
    const conflict = error.code.includes("conflict") || error.code === "lease_expired";
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
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          details: error.requestId ? { requestId: error.requestId } : undefined,
        },
      },
    };
  }
  return {
    exitCode: 1,
    result: {
      ok: false,
      error: { code: "internal", message: "Unexpected CLI failure.", retryable: false },
    },
  };
}
