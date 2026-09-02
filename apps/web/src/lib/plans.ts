export type OrganizationPlan = "free" | "paid";

export type ProjectCapacity = {
  plan: OrganizationPlan;
  activeProjectCount: number;
  activeProjectLimit: number | null;
  projectCapacitySource: "plan" | "operator_override";
  canCreateProject: boolean;
};

export const PLANNED_UNLIMITED_PLAN = {
  price: "$19",
  name: "Unlimited",
  features: ["Unlimited active projects", "Unlimited collaborators"] as const,
  billingAvailable: false,
} as const;

export function upgradePath(organizationSlug: string, projectSlug: string): string {
  return `/app/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(projectSlug)}/upgrade`;
}

export function projectCreationPath(organizationSlug: string): string {
  return `/onboarding?organization=${encodeURIComponent(organizationSlug)}`;
}

export function projectCapacityLabel(capacity: ProjectCapacity): string {
  if (capacity.activeProjectLimit === null) {
    return `Paid plan · ${capacity.activeProjectCount} active projects`;
  }
  const planLabel = capacity.plan === "free" ? "Free" : "Current";
  return `${planLabel} plan · ${capacity.activeProjectCount} of ${capacity.activeProjectLimit} active projects`;
}

export function projectCreationAction(
  capacity: ProjectCapacity,
  organizationSlug: string,
  projectSlug: string,
): { intent: "create" | "upgrade"; label: string; href: string } {
  if (capacity.plan === "free" && !capacity.canCreateProject) {
    return {
      intent: "upgrade",
      label: "Upgrade to add projects",
      href: upgradePath(organizationSlug, projectSlug),
    };
  }
  return {
    intent: "create",
    label: "Create another project",
    href: projectCreationPath(organizationSlug),
  };
}
