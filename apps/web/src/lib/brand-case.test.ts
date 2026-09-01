import { describe, expect, it } from "vitest";

import { lowercaseDongoBrand } from "./brand-case";

describe("runtime brand casing", () => {
  it("normalizes product names in server-provided display labels", () => {
    expect(lowercaseDongoBrand(["D", "ongo CLI"].join(""))).toBe("dongo CLI");
    expect(lowercaseDongoBrand(["D", "ONGO service agent"].join(""))).toBe("dongo service agent");
    expect(lowercaseDongoBrand(["Use D", "ongo with Codex"].join(""))).toBe("Use dongo with Codex");
  });

  it("does not rewrite unrelated words or lowercase product copy", () => {
    expect(lowercaseDongoBrand("dongo CLI")).toBe("dongo CLI");
    expect(lowercaseDongoBrand("Dongola build agent")).toBe("Dongola build agent");
  });
});
