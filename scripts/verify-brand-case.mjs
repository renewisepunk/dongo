import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";

const root = process.cwd();
const write = process.argv.includes("--write");
const sourceRoots = ["src", "apps", "packages", "convex", "integrations", "scripts"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const proseExtensions = new Set([".md", ".mdx", ".html"]);
const structuredTextExtensions = new Set([".json", ".jsonc", ".svg", ".xml"]);
const ignoredDirectories = new Set([".agent-work", ".git", "node_modules", "dist", ".wrangler", "coverage", "test-results", "playwright-report"]);
const ignoredFiles = new Set(["dongo-prd.md", "scripts/verify-brand-case.mjs"]);
const uppercaseBrand = /\bDongo\b/g;

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(absolute));
    else files.push(absolute);
  }
  return files;
}

function replaceRanges(value, ranges) {
  let result = value;
  for (const { start, end } of ranges.sort((a, b) => b.start - a.start)) {
    const text = result.slice(start, end);
    result = `${result.slice(0, start)}${text.replaceAll("Dongo", "dongo")}${result.slice(end)}`;
  }
  return result;
}

function sourceText(value, filename) {
  const ast = parse(value, {
    allowUndeclaredExports: true,
    sourceType: "unambiguous",
    plugins: ["typescript", ...(filename.endsWith("x") ? ["jsx"] : [])],
  });
  const ranges = [];
  const seen = new WeakSet();
  const visit = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (
      ["StringLiteral", "TemplateElement", "JSXText"].includes(node.type) &&
      typeof node.start === "number" &&
      typeof node.end === "number" &&
      uppercaseBrand.test(value.slice(node.start, node.end))
    ) {
      ranges.push({ start: node.start, end: node.end });
    }
    uppercaseBrand.lastIndex = 0;
    for (const [key, child] of Object.entries(node)) {
      if (["loc", "extra", "comments", "errors", "tokens"].includes(key)) continue;
      if (Array.isArray(child)) for (const item of child) visit(item);
      else visit(child);
    }
  };
  visit(ast);
  return { output: replaceRanges(value, ranges), ranges };
}

function markdownText(value) {
  let fenced = false;
  let changed = false;
  const output = value.split(/(?<=\n)/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    const pieces = line.split(/(`[^`]*`)/g);
    for (let index = 0; index < pieces.length; index += 2) {
      const next = pieces[index].replace(uppercaseBrand, "dongo");
      if (next !== pieces[index]) changed = true;
      pieces[index] = next;
      uppercaseBrand.lastIndex = 0;
    }
    return pieces.join("");
  }).join("");
  return { output, ranges: changed ? [{}] : [] };
}

const candidates = new Set();
for (const sourceRoot of sourceRoots) {
  for (const file of await filesUnder(path.join(root, sourceRoot))) candidates.add(file);
}
for (const file of await filesUnder(root)) {
  const extension = path.extname(file);
  if (proseExtensions.has(extension) || structuredTextExtensions.has(extension)) {
    candidates.add(file);
  }
}

const violations = [];
for (const file of candidates) {
  const relative = path.relative(root, file);
  if (ignoredFiles.has(relative)) continue;
  const extension = path.extname(file);
  if (
    !sourceExtensions.has(extension) &&
    !proseExtensions.has(extension) &&
    !structuredTextExtensions.has(extension)
  ) continue;
  const value = await readFile(file, "utf8");
  const result = sourceExtensions.has(extension)
    ? sourceText(value, file)
    : extension === ".md" || extension === ".mdx"
      ? markdownText(value)
      : {
          output: value.replaceAll("Dongo", "dongo"),
          ranges: uppercaseBrand.test(value) ? [{}] : [],
        };
  uppercaseBrand.lastIndex = 0;
  if (result.output === value) continue;
  violations.push(relative);
  if (write) await writeFile(file, result.output);
}

if (violations.length > 0 && !write) {
  console.error("Static product copy must spell the brand as lowercase dongo:");
  for (const file of violations) console.error(`- ${file}`);
  process.exit(1);
}

if (write) console.log(`Updated ${violations.length} files to lowercase dongo product copy.`);
