import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const runtimeFile = /^(?:apps|packages)\/[^/]+\/src\/.*\.(?:ts|tsx)$/u;
const convexFile = /^convex\/(?!_generated\/).*\.ts$/u;
const generatedFile = /worker-configuration\.d\.ts$/u;
const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 16 * 1_024 * 1_024,
})
  .split("\0")
  .filter(
    (path) =>
      !generatedFile.test(path) && (runtimeFile.test(path) || convexFile.test(path)),
  );

const findings = [];
for (const path of trackedFiles) {
  const sourceText = readFileSync(path, "utf8");
  for (const call of consoleCalls(sourceText)) {
    if (
      /\b(?:error|source|cause)\.message\b/u.test(call.text) ||
      /\berrorMessage\s*:/u.test(call.text)
    ) {
      findings.push({
        path,
        line: sourceText.slice(0, call.start).split("\n").length,
        reason: "raw exception message in runtime console output",
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Unsafe runtime log fields found:");
  for (const finding of findings) {
    console.error(`- ${finding.path}:${finding.line} (${finding.reason})`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Runtime console output avoids raw exception messages across ${trackedFiles.length} source files.`,
  );
}

function consoleCalls(source) {
  const calls = [];
  const pattern = /console\.(?:debug|error|info|log|warn)\s*\(/gu;
  for (const match of source.matchAll(pattern)) {
    let index = match.index + match[0].length;
    let depth = 1;
    let quote;
    while (index < source.length && depth > 0) {
      const character = source[index];
      const next = source[index + 1];
      if (quote !== undefined) {
        if (character === "\\") {
          index += 2;
          continue;
        }
        if (character === quote) quote = undefined;
        index += 1;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        index += 1;
        continue;
      }
      if (character === "/" && next === "/") {
        index = source.indexOf("\n", index + 2);
        if (index === -1) index = source.length;
        continue;
      }
      if (character === "/" && next === "*") {
        const end = source.indexOf("*/", index + 2);
        index = end === -1 ? source.length : end + 2;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      index += 1;
    }
    calls.push({ start: match.index, text: source.slice(match.index, index) });
  }
  return calls;
}
