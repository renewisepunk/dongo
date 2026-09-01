import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertJsonSize } from "./errors";

export async function appendEvent(
  ctx: MutationCtx,
  event: {
    organizationId: Id<"organizations">;
    projectId?: Id<"projects">;
    ideaId?: Id<"ideas">;
    intakeId?: Id<"intakes">;
    workItemId?: Id<"workItems">;
    runId?: Id<"runs">;
    actorId: Id<"actors">;
    type: string;
    data?: unknown;
    requestId?: string;
    createdAt: number;
  },
): Promise<Id<"events">> {
  const data = event.data ?? {};
  assertJsonSize(data, 8_192);
  return await ctx.db.insert("events", { ...event, data });
}
