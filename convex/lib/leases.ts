import { fail } from "./errors";

export const CLAIM_LEASE_MS = 30 * 60 * 1_000;
const MIN_CLAIM_LEASE_SECONDS = 30;
const MAX_CLAIM_LEASE_SECONDS = 60 * 60;

export function newLease(
  now: number,
  leaseSeconds?: number,
): { claimedAt: number; claimExpiresAt: number } {
  const duration = leaseSeconds ?? CLAIM_LEASE_MS / 1_000;
  if (
    !Number.isInteger(duration) ||
    duration < MIN_CLAIM_LEASE_SECONDS ||
    duration > MAX_CLAIM_LEASE_SECONDS
  ) {
    fail("validation", "leaseSeconds must be an integer between 30 and 3600");
  }
  return { claimedAt: now, claimExpiresAt: now + duration * 1_000 };
}

export function isLeaseActive(
  claimExpiresAt: number | undefined,
  now: number,
): boolean {
  return claimExpiresAt !== undefined && claimExpiresAt > now;
}
