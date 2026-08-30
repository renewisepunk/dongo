import { z } from "zod";

const id = z.string().min(1).max(200);
const safeLabel = z.string().min(1).max(300);

const common = {
  version: z.literal(1),
  deliveryId: id,
  idempotencyKey: z.string().min(1).max(256),
  attentionRequestId: id,
  workItemId: id,
  projectId: id,
  deepLink: z.url().max(2_048),
};

export const deliveryRequestSchema = z.discriminatedUnion("channel", [
  z.object({
    ...common,
    channel: z.literal("push"),
    platform: z.enum(["ios", "android"]),
    pushToken: z.string().min(1).max(4_096),
  }),
  z.object({
    ...common,
    channel: z.literal("email"),
    email: z.email().max(320),
    projectName: safeLabel,
    workIdentifier: safeLabel,
    workTitle: safeLabel,
    attentionKind: z.enum(["review", "decision", "question", "blocked"]),
    attentionTitle: safeLabel,
  }),
]);

export type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;
export type PushDeliveryRequest = Extract<DeliveryRequest, { channel: "push" }>;
export type EmailDeliveryRequest = Extract<DeliveryRequest, { channel: "email" }>;

export type DeliverySuccess = {
  ok: true;
  provider: "resend" | "apns" | "fcm";
  messageId: string;
};

export type DeliveryFailure = {
  ok: false;
  error: {
    code: string;
    retryable: boolean;
    disableDevice?: boolean;
  };
};

export type DeliveryResult = DeliverySuccess | DeliveryFailure;
