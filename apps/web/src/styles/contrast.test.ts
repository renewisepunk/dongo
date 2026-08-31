import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");

function token(name: string): string {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing color token --${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("dark theme contrast", () => {
  it("keeps every text tier readable against the page background", () => {
    const background = token("bg");
    for (const name of ["text", "text-soft", "text-body", "text-muted", "text-dim", "text-quiet", "text-faint", "text-ghost"]) {
      expect(contrast(token(name), background), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps dividers and open surfaces distinguishable without making them bright", () => {
    const background = token("bg");
    expect(contrast(token("line-soft"), background)).toBeGreaterThanOrEqual(1.3);
    expect(contrast(token("line"), background)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(token("line-strong"), background)).toBeGreaterThanOrEqual(2.5);
    expect(contrast(token("surface-1"), background)).toBeGreaterThanOrEqual(1.05);
    expect(contrast(token("surface-2"), background)).toBeGreaterThanOrEqual(1.1);
  });
});
