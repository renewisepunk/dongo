const DEVELOPMENT_ORIGIN = "https://dev.dongo.so";

export const INITIAL_SUPER_ADMIN_EMAIL = "rene@wisepunk.com";

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function developmentSignupAllowlist(
  configured = process.env.DONGO_DEV_SIGNUP_ALLOWLIST,
): ReadonlySet<string> {
  const values = configured === undefined
    ? [INITIAL_SUPER_ADMIN_EMAIL]
    : configured.split(",");
  const emails = new Set<string>();
  for (const value of values) {
    const email = normalizedEmail(value);
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new Error("DONGO_DEV_SIGNUP_ALLOWLIST contains an invalid email");
    }
    emails.add(email);
  }
  return emails;
}

export function developmentSignupAllowed(
  email: string,
  origin: string | undefined,
  configured = process.env.DONGO_DEV_SIGNUP_ALLOWLIST,
): boolean {
  if (origin !== DEVELOPMENT_ORIGIN) return true;
  return developmentSignupAllowlist(configured).has(normalizedEmail(email));
}
