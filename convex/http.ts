import { httpRouter } from "convex/server";
import {
  bindOAuth,
  executeAgent,
  finalizeAttachment,
  resolveOAuth,
  resolveServiceCredential,
} from "./gateway/httpActions";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutesLazy(http, createAuth, {
  cors: true,
  trustedOrigins: [process.env.SITE_URL!],
});

http.route({
  path: "/internal/agent/v1/execute",
  method: "POST",
  handler: executeAgent,
});
http.route({
  path: "/internal/oauth/v1/resolve",
  method: "POST",
  handler: resolveOAuth,
});
http.route({
  path: "/internal/oauth/v1/bind",
  method: "POST",
  handler: bindOAuth,
});
http.route({
  path: "/internal/attachments/v1/finalize",
  method: "POST",
  handler: finalizeAttachment,
});
http.route({
  path: "/internal/service-credentials/v1/resolve",
  method: "POST",
  handler: resolveServiceCredential,
});

export default http;
