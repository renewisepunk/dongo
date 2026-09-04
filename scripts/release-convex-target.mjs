import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const RELEASE_CONVEX_TARGETS = Object.freeze({
  development: "dev:wandering-camel-662",
  production: "prod:brainy-camel-172",
});

const configurationFiles = [".env.local", ".env"];
const configurationKeys = ["CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY"];

export function requireReleaseConvexTarget({
  root,
  stage,
  environment = process.env,
}) {
  const expected = RELEASE_CONVEX_TARGETS[stage];
  if (!expected) throw new Error(`Unknown release stage: ${stage}`);

  const fileLayers = configurationFiles.map((filename) =>
    readConfigurationLayer(resolve(root, filename), filename),
  );
  const resolved = {};
  for (const key of configurationKeys) {
    if (Object.hasOwn(environment, key)) {
      resolved[key] = { value: environment[key]?.trim() ?? "", source: "process environment" };
      continue;
    }
    for (const layer of fileLayers) {
      if (layer?.values[key] !== undefined) {
        resolved[key] = { value: layer.values[key].trim(), source: layer.filename };
        break;
      }
    }
  }

  const selector = resolved.CONVEX_DEPLOYMENT;
  if (!selector?.value) {
    throw targetError(
      stage,
      `CONVEX_DEPLOYMENT is missing from the trusted deployment bridge and owner-controlled ignored configuration. Expected ${expected}; local Convex fallback is forbidden.`,
    );
  }
  if (selector.value !== expected) {
    throw targetError(
      stage,
      `CONVEX_DEPLOYMENT from ${selector.source} does not select the expected named target ${expected}. Local, cross-environment, and unknown targets are forbidden.`,
    );
  }

  const deployKey = resolved.CONVEX_DEPLOY_KEY;
  if (deployKey?.value) {
    const keyTarget = deployKey.value.includes("|") ? deployKey.value.slice(0, deployKey.value.indexOf("|")) : "";
    if (keyTarget !== expected) {
      throw targetError(
        stage,
        `CONVEX_DEPLOY_KEY from ${deployKey.source} cannot be verified for the expected named target ${expected}. Replace or remove the mismatched credential; its value was not logged.`,
      );
    }
  }

  return {
    environment: {
      ...environment,
      CONVEX_DEPLOYMENT: expected,
      ...(deployKey?.value ? { CONVEX_DEPLOY_KEY: deployKey.value } : {}),
    },
    source: selector.source,
    target: expected,
  };
}

function readConfigurationLayer(path, filename) {
  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw targetError("release", `Could not inspect ignored deployment configuration ${filename}.`);
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (typeof process.getuid === "function" && info.uid !== process.getuid()) ||
    (info.mode & 0o022) !== 0
  ) {
    throw targetError(
      "release",
      `Ignored deployment configuration ${filename} must be an owner-controlled, non-writable-by-others regular file.`,
    );
  }
  try {
    return { filename, values: parseEnv(readFileSync(path, "utf8")) };
  } catch {
    throw targetError("release", `Ignored deployment configuration ${filename} is not a valid environment file.`);
  }
}

function targetError(stage, detail) {
  const label = stage === "development" || stage === "production" ? `${stage[0].toUpperCase()}${stage.slice(1)} release` : "Release";
  const error = new Error(`${label} blocked before mutation: ${detail}`);
  error.code = "release_convex_target_invalid";
  return error;
}
