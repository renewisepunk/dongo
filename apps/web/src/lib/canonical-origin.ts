export function canonicalRedirectUrl(
  requestUrl: string,
  canonicalOrigin: string,
): string | undefined {
  const request = new URL(requestUrl);
  const canonical = new URL(canonicalOrigin);
  if (
    canonical.protocol !== "https:" ||
    canonical.username !== "" ||
    canonical.password !== "" ||
    canonical.port !== "" ||
    canonical.pathname !== "/" ||
    canonical.search !== "" ||
    canonical.hash !== ""
  ) {
    throw new Error("The canonical dongo origin is invalid");
  }
  if (
    request.protocol !== "https:" ||
    request.hostname.toLowerCase() !== `www.${canonical.hostname.toLowerCase()}`
  ) {
    return undefined;
  }
  return new URL(`${request.pathname}${request.search}`, canonical).toString();
}
