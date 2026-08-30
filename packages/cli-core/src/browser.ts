import { spawn } from "node:child_process";

import { sanitizedChildEnvironment } from "./process-environment.ts";

export interface BrowserOpener {
  open(url: string): Promise<boolean>;
}

function runWithInput(command: string, args: string[], input: string, environment?: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env: sanitizedChildEnvironment(environment),
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
    child.stdin.end(input);
  });
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export class SystemBrowserOpener implements BrowserOpener {
  async open(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

    if (process.platform === "darwin") {
      return runWithInput("/usr/bin/osascript", [], `open location "${appleScriptString(parsed.toString())}"\n`);
    }
    if (process.platform === "win32") {
      return runWithInput(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "$u=[Console]::In.ReadToEnd(); Start-Process $u"],
        parsed.toString(),
      );
    }
    return runWithInput(
      "/bin/sh",
      ["-c", 'xdg-open "$DONGO_BROWSER_URL" >/dev/null 2>&1'],
      "",
      { DONGO_BROWSER_URL: parsed.toString() },
    );
  }
}
