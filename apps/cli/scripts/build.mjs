import { chmod, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(appRoot, "dist");
const outputFile = path.join(outputDirectory, "dongo.js");

await rm(outputDirectory, { force: true, recursive: true });
await build({
  absWorkingDir: appRoot,
  bundle: true,
  entryPoints: ["src/index.ts"],
  format: "esm",
  legalComments: "none",
  outfile: outputFile,
  platform: "node",
  target: "node20",
});
await chmod(outputFile, 0o755);
