const DRAFT_PREFIX = "dongo:draft:v1:";

function storage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readLocalDraft(key: string): string {
  try {
    return storage()?.getItem(`${DRAFT_PREFIX}${key}`) ?? "";
  } catch {
    return "";
  }
}

export function writeLocalDraft(key: string, value: string): void {
  try {
    const target = storage();
    if (!target) return;
    if (value) target.setItem(`${DRAFT_PREFIX}${key}`, value);
    else target.removeItem(`${DRAFT_PREFIX}${key}`);
  } catch {
    // A blocked or full local store must not prevent someone from responding.
  }
}

export function clearLocalDraft(key: string): void {
  writeLocalDraft(key, "");
}
