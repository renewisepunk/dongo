import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  {
    label: "private key material",
    expression: new RegExp(["-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"].join("")),
  },
  { label: "AWS access key", expression: /AKIA[0-9A-Z]{16}/ },
  { label: "Google API key", expression: /AIza[0-9A-Za-z_-]{35}/ },
  { label: "GitHub token", expression: /gh[pousr]_[0-9A-Za-z]{20,}/ },
  { label: "OpenAI token", expression: /sk-(?:proj-)?[0-9A-Za-z_-]{20,}/ },
  { label: "Resend token", expression: /re_[0-9A-Za-z]{20,}/ },
  { label: "Slack token", expression: /xox[baprs]-[0-9A-Za-z-]{20,}/ },
  { label: "Stripe token", expression: /sk_(?:live|test)_[0-9A-Za-z]{16,}/ },
  { label: "bearer token", expression: /Bearer\s+[0-9A-Za-z][0-9A-Za-z._~-]{31,}/i },
];

const allowedSourcePatterns = new Map([
  [
    "apps/notifications/src/jwt.ts",
    [
      {
        label: "private key material",
        expression: new RegExp(
          [String.raw`\.replace\(\/-----BEGIN `, String.raw`PRIVATE KEY-----\/g,\s*""\)`].join(""),
        ),
      },
    ],
  ],
]);

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

const findings = [];
for (const path of trackedFiles) {
  const contents = readFileSync(path);
  if (contents.includes(0)) continue;
  const lines = contents.toString("utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const { label, expression } of patterns) {
      if (!expression.test(line)) continue;
      const allowed = allowedSourcePatterns
        .get(path)
        ?.some((entry) => entry.label === label && entry.expression.test(line));
      if (!allowed) findings.push({ path, line: index + 1, label });
    }
  }
}

if (findings.length > 0) {
  console.error("Potential committed secrets found (values redacted):");
  for (const finding of findings) {
    console.error(`- ${finding.path}:${finding.line} (${finding.label})`);
  }
  process.exitCode = 1;
} else {
  console.log(`No high-confidence secrets found in ${trackedFiles.length} tracked files.`);
}
