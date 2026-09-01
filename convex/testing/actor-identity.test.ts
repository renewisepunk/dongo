import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";
import { normalizedActorIdentity } from "../domains/human/summary";
import { lowercaseDongoBrand } from "../lib/brand";

describe("agent actor identity", () => {
  it("normalizes product casing without rewriting technical identifiers", () => {
    const titleCase = ["Don", "go CLI"].join("");
    const allCaps = ["DON", "GO service agent"].join("");
    expect(lowercaseDongoBrand(titleCase)).toBe("dongo CLI");
    expect(lowercaseDongoBrand(allCaps)).toBe("dongo service agent");
    expect(lowercaseDongoBrand("DONGO_TOKEN")).toBe("DONGO_TOKEN");
    expect(lowercaseDongoBrand("DONGO-12")).toBe("DONGO-12");
    expect(lowercaseDongoBrand("DONGO.managed.md")).toBe("DONGO.managed.md");
  });

  it("keeps agent identity separate from installation transport metadata", () => {
    expect(normalizedActorIdentity(
      { type: "agent", name: "Claude Code", agentType: "mcp" },
      { kind: "mcp", label: "Claude Code", machineLabel: "Studio Mac" },
    )).toEqual({
      displayName: "Claude Code",
      agentType: undefined,
      transport: "mcp",
      transportLabel: "Claude Code",
      machineLabel: "Studio Mac",
    });
    expect(normalizedActorIdentity(
      { type: "agent", name: "MCP host", agentType: "mcp" },
      { kind: "mcp", label: "MCP host", machineLabel: undefined },
    )).toMatchObject({
      displayName: "Agent",
      agentType: undefined,
      transport: "mcp",
      transportLabel: "MCP host",
    });
    expect(normalizedActorIdentity(
      { type: "human", name: "Project Owner", agentType: undefined },
    )).toEqual({
      displayName: "Project Owner",
      agentType: undefined,
      transport: undefined,
      transportLabel: undefined,
      machineLabel: undefined,
    });
    expect(normalizedActorIdentity(
      { type: "agent", name: "   ", agentType: "  " },
      { kind: "cli", label: "   ", machineLabel: "  " },
    )).toEqual({
      displayName: "Agent",
      agentType: undefined,
      transport: "cli",
      transportLabel: undefined,
      machineLabel: undefined,
    });
    expect(normalizedActorIdentity(
      { type: "human", name: "  ", agentType: undefined },
    ).displayName).toBe("Member");
    expect(normalizedActorIdentity(
      {
        type: "agent",
        name: ["Don", "go Desktop"].join(""),
        agentType: ["DON", "GO agent"].join(""),
      },
      {
        kind: "cli",
        label: ["Don", "go Desktop"].join(""),
        machineLabel: ["DON", "GO Studio"].join(""),
      },
    )).toMatchObject({
      displayName: "dongo Desktop",
      agentType: "dongo agent",
      transportLabel: "dongo Desktop",
      machineLabel: "dongo Studio",
    });
  });

  it("stores a truthful fallback for generic OAuth labels and preserves later identity", async () => {
    const root = convexTest(schema, modules);
    const human = root.withIdentity({
      tokenIdentifier: "https://human.example.test|actor-owner",
      subject: "actor-owner",
      issuer: "https://human.example.test",
      email: "actor@example.test",
      name: "Actor Owner",
    });
    const profile = await human.mutation(
      api.domains.identity.index.bootstrapCurrentUser,
      {},
    );
    const organization = await human.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Actor Test", slug: `actor-${crypto.randomUUID()}` },
    );
    const project = await human.mutation(
      internal.domains.projects.index.createProject,
      {
        organizationId: organization.organizationId,
        name: "Actor Test",
        slug: "actor",
        identifierPrefix: "ACT",
        executionMode: "manual",
      },
    );
    const grant = {
      projectId: project.projectId,
      authorizedByProfileId: profile.profileId,
      kind: "mcp" as const,
      clientId: "actor-test-client",
      machineLabel: "Studio Mac",
      resource: "https://dongo.so/api/agent/v1",
      scopes: ["dongo:work:read"],
      providerIssuer: "https://dongo.so/api/auth",
      providerGrantId: "actor-test-grant",
      subject: "actor-test-subject",
    };
    const registered = await root.mutation(
      internal.domains.installations.index.registerOAuthGrant,
      { ...grant, label: "MCP host" },
    );
    let actor = await root.run((ctx) => ctx.db.get(registered.actorId));
    expect(actor).toMatchObject({ name: "Agent", type: "agent" });
    expect(actor).not.toHaveProperty("agentType");

    const replay = await root.mutation(
      internal.domains.installations.index.registerOAuthGrant,
      {
        ...grant,
        label: ["Don", "go Desktop"].join(""),
        machineLabel: ["DON", "GO Studio"].join(""),
      },
    );
    expect(replay).toMatchObject({ actorId: registered.actorId, created: false });
    actor = await root.run((ctx) => ctx.db.get(registered.actorId));
    expect(actor).toMatchObject({ name: "dongo Desktop", type: "agent" });
    expect(actor).not.toHaveProperty("agentType");
    const normalizedInstallation = await root.run((ctx) =>
      ctx.db.get(registered.installationId)
    );
    expect(normalizedInstallation).toMatchObject({
      label: "dongo Desktop",
      machineLabel: "dongo Studio",
    });
    const presence = await human.query(
      api.domains.agentUpdates.index.presence,
      { projectId: project.projectId },
    );
    expect(presence.installations[0]?.actor).toMatchObject({
      displayName: "dongo Desktop",
      transportLabel: "dongo Desktop",
      machineLabel: "dongo Studio",
    });

    await root.run((ctx) => ctx.db.patch(registered.installationId, {
      label: "   ",
      machineLabel: "  ",
    }));
    const listed = await human.query(api.domains.installations.index.listForProject, {
      projectId: project.projectId,
    });
    expect(listed).toEqual([
      expect.objectContaining({
        _id: registered.installationId,
        label: "MCP host",
      }),
    ]);
    expect(listed[0]).not.toHaveProperty("machineLabel");
  });
});
