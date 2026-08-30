import { describe, expect, it } from "vitest";

import { mapOverviewSnapshot, type OverviewSnapshot } from "./project-data";

describe("live project overview mapping", () => {
  it("maps Convex state without inventing fixture activity", () => {
    const now = 1_800_000_000_000;
    const ready = {
      _id: "work-ready",
      identifier: "DON-1",
      title: "Ship the live overview",
      description: "Render only durable project state.",
      state: "ready" as const,
      rank: 1_024,
      revision: 2,
      createdAt: now - 120_000,
      updatedAt: now - 60_000,
    };
    const attentionWork = {
      ...ready,
      _id: "work-attention",
      identifier: "DON-2",
      title: "Choose an auth mode",
      state: "working" as const,
    };
    const snapshot: OverviewSnapshot = {
      project: { _id: "project-1", name: "Dongo", publicRef: "dongo-ref" },
      generatedAt: now,
      needsYou: [{
        work: attentionWork,
        actor: { _id: "actor-1", type: "agent", name: "Codex" },
        request: {
          _id: "attention-1",
          requestedByActorId: "actor-1",
          kind: "decision",
          title: "Opaque or JWT",
          body: "Choose the production token format.",
          options: ["Opaque", "JWT"],
          urgency: "important",
          status: "open",
          createdAt: now - 30_000,
        },
      }],
      working: [],
      ready: [{ work: ready, effectiveState: "ready", staleClaim: false }],
      inbox: [{
        intake: {
          _id: "intake-1",
          text: "Wire the real data",
          status: "new",
          createdAt: now - 5_000,
        },
        attachments: [],
      }],
      recentlyDone: [],
    };

    const result = mapOverviewSnapshot(snapshot);

    expect(result.projectId).toBe("project-1");
    expect(result.work).toHaveLength(2);
    expect(result.work[0]).toMatchObject({
      id: "work-attention",
      state: "needs",
      agent: "Codex",
      unseen: true,
      revision: 2,
      attention: { id: "attention-1", kind: "Decision", important: true },
    });
    expect(result.intakes).toEqual([expect.objectContaining({
      id: "intake-1",
      text: "Wire the real data",
      status: "waiting",
      attachmentCount: 0,
    })]);
    expect(result.work.some((item) => item.identifier === "DON-143")).toBe(false);
  });
});
