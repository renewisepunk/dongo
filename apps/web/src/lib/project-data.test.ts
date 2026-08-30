import { describe, expect, it } from "vitest";

import {
  mapAvailableProjects,
  mapIntakeDetail,
  mapOverviewSnapshot,
  type OverviewSnapshot,
} from "./project-data";

describe("live project overview mapping", () => {
  it("maps only authorized active projects without crossing organization metadata", () => {
    const projects = mapAvailableProjects([
      {
        membership: { organizationId: "org-1", role: "owner" },
        organization: {
          _id: "org-1",
          name: "Studio",
          slug: "studio",
          plan: "free",
        },
        projects: [
          {
            _id: "project-1",
            publicRef: "public-1",
            name: "Checkout",
            slug: "checkout",
            identifierPrefix: "CHK",
            executionMode: "manual",
          },
          {
            _id: "project-archived",
            publicRef: "public-old",
            name: "Old app",
            slug: "old-app",
            identifierPrefix: "OLD",
            executionMode: "manual",
            archivedAt: 123,
          },
        ],
      },
      {
        membership: { organizationId: "org-2", role: "member" },
        organization: {
          _id: "org-2",
          name: "Client",
          slug: "client",
          plan: "paid",
        },
        projects: [{
          _id: "project-2",
          publicRef: "public-2",
          name: "Portal",
          slug: "portal",
          identifierPrefix: "POR",
          executionMode: "autonomous",
        }],
      },
    ]);

    expect(projects).toEqual([
      expect.objectContaining({
        id: "project-1",
        organizationName: "Studio",
        organizationSlug: "studio",
        membershipRole: "owner",
        activeProjectCount: 1,
      }),
      expect.objectContaining({
        id: "project-2",
        organizationName: "Client",
        organizationSlug: "client",
        membershipRole: "member",
        activeProjectCount: 1,
      }),
    ]);
  });

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
        staleClaim: false,
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

  it("maps a direct Intake detail with attachments and Work links", () => {
    const mapped = mapIntakeDetail({
      intake: {
        _id: "intake-direct",
        clientRequestId: "submission-direct",
        text: "Investigate the deep link",
        status: "processed",
        createdAt: Date.now(),
      },
      attachments: [{ _id: "attachment-1", filename: "context.png" }],
      links: [{ workItemId: "work-1" }],
    });

    expect(mapped).toMatchObject({
      id: "intake-direct",
      submissionKey: "submission-direct",
      status: "processed",
      attachment: "context.png",
      attachmentCount: 1,
      linkedWorkIds: ["work-1"],
    });
  });

  it("does not present an expired Intake claim as active triage", () => {
    const mapped = mapIntakeDetail({
      intake: {
        _id: "intake-stale",
        text: "Reclaim this Intake",
        status: "claimed",
        claimExpiresAt: Date.now() - 1,
        createdAt: Date.now() - 60_000,
      },
      attachments: [],
      links: [],
    });

    expect(mapped.status).toBe("waiting");
  });
});
