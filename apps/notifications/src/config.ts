import { z } from "zod";

const resendSchema = z.object({
  apiKey: z.string().min(16).max(1_024),
});

const apnsSchema = z.object({
  teamId: z.string().regex(/^[A-Z0-9]{10}$/),
  keyId: z.string().regex(/^[A-Z0-9]{10}$/),
  bundleId: z.string().min(3).max(255),
  environment: z.enum(["sandbox", "production"]),
  privateKeyPkcs8: z.string().min(100).max(10_000),
});

const fcmSchema = z.object({
  projectId: z.string().min(1).max(256),
  clientEmail: z.email().max(320),
  privateKeyPkcs8: z.string().min(100).max(10_000),
});

function parseSecretConfig<T>(
  value: string,
  schema: z.ZodType<T>,
): T | undefined {
  if (value === "disabled") return undefined;
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export type ResendConfig = z.infer<typeof resendSchema>;
export type ApnsConfig = z.infer<typeof apnsSchema>;
export type FcmConfig = z.infer<typeof fcmSchema>;

export const notificationProviderNames = ["resend", "apns", "fcm"] as const;
export type NotificationProviderName = (typeof notificationProviderNames)[number];

export function requiredNotificationProviders(
  value: string,
): readonly NotificationProviderName[] {
  const requested = new Set(
    value.split(",").map((entry) => entry.trim()).filter(Boolean),
  );
  if (
    requested.size === 0 ||
    [...requested].some(
      (entry) => !notificationProviderNames.includes(entry as NotificationProviderName),
    )
  ) {
    return notificationProviderNames;
  }
  return notificationProviderNames.filter((provider) => requested.has(provider));
}

export function providerConfig(env: Env): {
  resend?: ResendConfig;
  apns?: ApnsConfig;
  fcm?: FcmConfig;
} {
  return {
    resend: parseSecretConfig(env.DONGO_RESEND_CONFIG, resendSchema),
    apns: parseSecretConfig(env.DONGO_APNS_CONFIG, apnsSchema),
    fcm: parseSecretConfig(env.DONGO_FCM_CONFIG, fcmSchema),
  };
}
