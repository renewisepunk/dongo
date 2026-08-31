export function safeMarkdownHref(value: string): string | undefined {
  const href = value.trim();
  if (href.startsWith("#") || (href.startsWith("/") && !href.startsWith("//"))) return href;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
