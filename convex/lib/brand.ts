const noncanonicalProductCase = /\b(?:Dongo|DONGO)\b(?![-_.])/gu;

export function lowercaseDongoBrand(value: string): string {
  return value.replace(noncanonicalProductCase, "dongo");
}
