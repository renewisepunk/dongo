export const MAX_ATTACHMENT_BYTES = 250 * 1_024 * 1_024;
export const FREE_ORGANIZATION_BYTES = 1 * 1_024 * 1_024 * 1_024;
export const PAID_ORGANIZATION_BYTES = 20 * 1_024 * 1_024 * 1_024;
export const FREE_ACTIVE_PROJECT_LIMIT = 1;
export const MAX_ACTIVE_PROJECT_LIMIT_OVERRIDE = 100;
export const FREE_TOTAL_WORK_ITEM_LIMIT = 250;
export const MAX_TOTAL_WORK_ITEM_LIMIT_OVERRIDE = 1_000;

export type OrganizationPlan = "free" | "paid";
export type ProjectCapacitySource = "plan" | "operator_override";
export type WorkCapacitySource = "plan" | "operator_override";

export function activeProjectLimit(
  plan: OrganizationPlan,
  override: number | undefined,
): number | undefined {
  if (plan === "paid") return undefined;
  return override ?? FREE_ACTIVE_PROJECT_LIMIT;
}

export function projectCapacitySource(
  plan: OrganizationPlan,
  override: number | undefined,
): ProjectCapacitySource {
  return plan === "free" && override !== undefined
    ? "operator_override"
    : "plan";
}

export function totalWorkItemLimit(
  plan: OrganizationPlan,
  override: number | undefined,
): number | undefined {
  if (override !== undefined) return override;
  return plan === "free" ? FREE_TOTAL_WORK_ITEM_LIMIT : undefined;
}

export function workCapacitySource(
  override: number | undefined,
): WorkCapacitySource {
  return override === undefined ? "plan" : "operator_override";
}

export function organizationStorageLimit(plan: OrganizationPlan): number {
  return plan === "free" ? FREE_ORGANIZATION_BYTES : PAID_ORGANIZATION_BYTES;
}
