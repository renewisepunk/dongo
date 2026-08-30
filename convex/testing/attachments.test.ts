import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";

const gatewaySecret = "test-gateway-secret-with-at-least-32-characters";

beforeEach(() => {
  process.env.DONGO_INTERNAL_GATEWAY_SECRET = gatewaySecret;
  process.env.DONGO_ATTACHMENT_URL_SIGNING_SECRET = gatewaySecret;
  process.env.DONGO_ATTACHMENT_UPLOAD_BASE_URL =
    "https://dev.dongo.so/api/files/upload";
  process.env.DONGO_ATTACHMENT_DOWNLOAD_BASE_URL =
    "https://dev.dongo.so/api/files/download";
});

describe("attachment edge contract", () => {
  it("issues a bound upload URL and finalizes through the replay-safe gateway", async () => {
    const root = convexTest(schema, modules);
    const t = root.withIdentity({
      tokenIdentifier: "https://human.example.test|attachment-owner",
      subject: "attachment-owner",
      issuer: "https://human.example.test",
      email: "owner@example.test",
      name: "Attachment Owner",
    });
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const slug = `org-${crypto.randomUUID()}`;
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Attachment Test", slug },
    );
    const project = await t.mutation(api.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Attachment Test",
      slug: "attachments",
      identifierPrefix: "ATT",
      executionMode: "manual",
    });
    const reserved = await t.action(
      api.domains.attachments.actions.reserveUpload,
      {
        projectId: project.projectId,
        filename: "proof.txt",
        mimeType: "text/plain",
        byteSize: 5,
        checksumSha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(reserved.transport).toBe("single");
    if (reserved.transport !== "single") throw new Error("Expected single upload");
    const uploadUrl = new URL(reserved.uploadUrl);
    expect(uploadUrl.origin).toBe("https://dev.dongo.so");
    expect(uploadUrl.pathname).toBe(
      `/api/files/upload/${reserved.attachmentId}`,
    );
    expect(uploadUrl.searchParams.get("maxBytes")).toBe("5");
    expect(reserved.requiredHeaders).toMatchObject({
      "content-type": "text/plain",
    });

    const large = await t.action(
      api.domains.attachments.actions.reserveUpload,
      {
        projectId: project.projectId,
        filename: "walkthrough.mov",
        mimeType: "video/quicktime",
        byteSize: 33 * 1_024 * 1_024,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(large.transport).toBe("multipart");
    if (large.transport !== "multipart") throw new Error("Expected multipart upload");
    const createUrl = new URL(large.createUrl);
    expect(createUrl.origin).toBe("https://dev.dongo.so");
    expect(createUrl.pathname).toBe(
      `/api/files/multipart/${large.attachmentId}`,
    );
    expect(large.partSize).toBe(8 * 1_024 * 1_024);
    expect(large.partCount).toBe(5);
    expect(createUrl.searchParams.get("partSize")).toBe(String(large.partSize));
    expect(createUrl.searchParams.get("partCount")).toBe(String(large.partCount));

    await expect(t.action(
      api.domains.attachments.actions.reserveUpload,
      {
        projectId: project.projectId,
        filename: "checksummed.mov",
        mimeType: "video/quicktime",
        byteSize: 33 * 1_024 * 1_024,
        checksumSha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        idempotencyKey: crypto.randomUUID(),
      },
    )).rejects.toThrow("Checksummed uploads larger than 32 MB are not supported");

    const body = JSON.stringify({
      version: 1,
      requestId: "attachment-finalize-1",
      input: {
        attachmentId: reserved.attachmentId,
        observedByteSize: 5,
        observedMimeType: "text/plain",
        observedChecksumSha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
    });
    const request = await signedRequest(
      "/internal/attachments/v1/finalize",
      body,
    );
    const response = await t.fetch(
      "/internal/attachments/v1/finalize",
      request,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      apiVersion: "v1",
      requestId: "attachment-finalize-1",
      data: { attachmentId: reserved.attachmentId, status: "available" },
    });
    const download = await t.action(
      api.domains.attachments.actions.downloadForHuman,
      { attachmentId: reserved.attachmentId },
    );
    const downloadUrl = new URL(download.downloadUrl);
    expect(downloadUrl.origin).toBe("https://dev.dongo.so");
    expect(downloadUrl.pathname).toBe(
      `/api/files/download/${reserved.attachmentId}`,
    );
    expect(download).toMatchObject({
      attachmentId: reserved.attachmentId,
      filename: "proof.txt",
      contentType: "text/plain",
      byteSize: 5,
    });
    expect(downloadUrl.searchParams.get("signature")).toBe(
      await hmacBase64Url(
        gatewaySecret,
        `${reserved.attachmentId}\n${reserved.storageKey}\n${download.expiresAt}`,
      ),
    );
    const publicAttachment = await t.query(
      api.domains.attachments.index.getForHuman,
      { attachmentId: reserved.attachmentId },
    );
    expect(publicAttachment).toEqual({
      _id: reserved.attachmentId,
      filename: "proof.txt",
      mimeType: "text/plain",
      byteSize: 5,
    });
    const createdIntake = await t.mutation(api.domains.intake.index.create, {
      projectId: project.projectId,
      text: "Review the attachment privacy boundary",
      attachmentIds: [reserved.attachmentId],
      idempotencyKey: crypto.randomUUID(),
    });
    const intakeDetail = await t.query(
      api.domains.intake.index.getForHuman,
      { intakeId: createdIntake.intakeId },
    );
    expect(intakeDetail.attachments).toEqual([publicAttachment]);
    const overview = await t.query(
      api.domains.overview.index.getForHuman,
      { projectId: project.projectId },
    );
    expect(
      overview.inbox.find(({ intake }) => intake._id === createdIntake.intakeId)
        ?.attachments,
    ).toEqual([publicAttachment]);
    const createdWork = await t.mutation(
      api.domains.work.index.createForHuman,
      {
        projectId: project.projectId,
        title: "Attachment privacy",
        description: "Keep internal object metadata server-side",
        kind: "task",
        sourceIntakeIds: [createdIntake.intakeId],
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const workDetail = await t.query(
      api.domains.work.index.getDetailForHuman,
      { workItemId: createdWork.workItemId },
    );
    expect(workDetail.sourceIntakes).toHaveLength(1);
    expect(workDetail.sourceIntakes[0]?.attachments).toEqual([publicAttachment]);
    const stranger = root.withIdentity({
      tokenIdentifier: "https://human.example.test|attachment-stranger",
      subject: "attachment-stranger",
      issuer: "https://human.example.test",
      email: "stranger@example.test",
      name: "Attachment Stranger",
    });
    await stranger.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    await expect(stranger.action(
      api.domains.attachments.actions.downloadForHuman,
      { attachmentId: reserved.attachmentId },
    )).rejects.toThrow("Organization or project not found");
    const replay = await t.fetch(
      "/internal/attachments/v1/finalize",
      request,
    );
    expect(replay.status).toBe(401);
  });

  it("discards an unattached reservation and releases its quota", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|discard-owner",
      subject: "discard-owner",
      issuer: "https://human.example.test",
      email: "discard@example.test",
      name: "Discard Owner",
    });
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const slug = `org-${crypto.randomUUID()}`;
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Discard Test", slug },
    );
    const project = await t.mutation(api.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Discard Test",
      slug: "discard",
      identifierPrefix: "DSC",
      executionMode: "manual",
    });
    const reserved = await t.mutation(api.domains.attachments.index.reserve, {
      projectId: project.projectId,
      filename: "cancelled.mov",
      mimeType: "video/quicktime",
      byteSize: 128,
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      t.mutation(api.domains.attachments.index.discard, {
        attachmentId: reserved.attachmentId,
      }),
    ).resolves.toMatchObject({
      attachmentId: reserved.attachmentId,
      deleted: true,
    });
    const state = await t.run(async (ctx) => {
      const attachment = await ctx.db.get(reserved.attachmentId);
      const ledger = await ctx.db
        .query("storageLedgers")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization.organizationId),
        )
        .unique();
      return { attachment, ledger };
    });
    expect(state.attachment?.status).toBe("deleted");
    expect(state.ledger?.reservedBytes).toBe(0);
  });
});

async function signedRequest(path: string, body: string): Promise<RequestInit> {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(new TextEncoder().encode(body));
  const canonical = `${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`;
  const signature = await hmacBase64Url(gatewaySecret, canonical);
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dongo-key-id": "v1",
      "x-dongo-timestamp": timestamp,
      "x-dongo-nonce": nonce,
      "x-dongo-signature": signature,
    },
    body,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64Url(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
