import { describe, expect, it } from "vitest";

import {
  PLANNED_UNLIMITED_PLAN,
  projectCapacityLabel,
  projectCreationAction,
  upgradePath,
} from "./plans";

describe("plan presentation", () => {
  it("offers the upgrade route when the standard Free allowance is full", () => {
    expect(projectCreationAction({
      plan: "free",
      activeProjectCount: 1,
      activeProjectLimit: 1,
      projectCapacitySource: "plan",
      canCreateProject: false,
    }, "Fixture Studio", "dongo/web")).toEqual({
      intent: "upgrade",
      label: "Upgrade to add projects",
      href: "/app/Fixture%20Studio/dongo%2Fweb/upgrade",
    });
  });

  it("preserves project creation for finite operator-granted Free capacity", () => {
    const capacity = {
      plan: "free" as const,
      activeProjectCount: 2,
      activeProjectLimit: 5,
      projectCapacitySource: "operator_override" as const,
      canCreateProject: true,
    };
    expect(projectCreationAction(capacity, "fixture-studio", "dongo")).toMatchObject({
      intent: "create",
      href: "/onboarding?organization=fixture-studio",
    });
    expect(projectCapacityLabel(capacity)).toBe("Free plan · 2 of 5 active projects");
  });

  it("keeps paid capacity unlimited and the planned offer non-activating", () => {
    expect(projectCapacityLabel({
      plan: "paid",
      activeProjectCount: 7,
      activeProjectLimit: null,
      projectCapacitySource: "plan",
      canCreateProject: true,
    })).toBe("Paid plan · 7 active projects");
    expect(PLANNED_UNLIMITED_PLAN).toMatchObject({ price: "$19", billingAvailable: false });
    expect(upgradePath("fixture-studio", "dongo")).toBe(
      "/app/fixture-studio/dongo/upgrade",
    );
  });
});
