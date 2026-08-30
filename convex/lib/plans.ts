export const MAX_ATTACHMENT_BYTES = 250 * 1_024 * 1_024;
export const FREE_ORGANIZATION_BYTES = 1 * 1_024 * 1_024 * 1_024;
export const PAID_ORGANIZATION_BYTES = 20 * 1_024 * 1_024 * 1_024;

export function organizationStorageLimit(plan: "free" | "paid"): number {
  return plan === "free" ? FREE_ORGANIZATION_BYTES : PAID_ORGANIZATION_BYTES;
}
