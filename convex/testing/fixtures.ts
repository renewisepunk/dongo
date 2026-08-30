/**
 * Stable fixture values for transport and convex-test suites. Keeping IDs out
 * of these fixtures makes them reusable after each isolated database reset.
 */
export const walkingSkeletonFixture = {
  developmentKey: "convex-test-user",
  organizationSlug: "convex-test-org",
  projectSlug: "convex-test-project",
  projectName: "Convex test project",
  identifierPrefix: "TST",
} as const;

export const agentScopesFixture = [
  "dongo:work:read",
  "dongo:work:write",
  "dongo:attachments:read",
] as const;

export const triageFixture = {
  intakeText: "Checkout becomes stuck after returning from the payment page.",
  work: {
    title: "Fix checkout return deadlock",
    description: "Reproduce and repair the checkout return path.",
    kind: "bug" as const,
  },
} as const;
