export function lowercaseDongoBrand(value: string): string {
  return value.replace(/\b(?:Dongo|DONGO)\b/gu, "dongo");
}
