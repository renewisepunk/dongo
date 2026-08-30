import { cimd } from "@better-auth/cimd";
import {
  DEVICE_CODE_GRANT_TYPE,
  oauthDeviceAuthorization,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import Database from "better-sqlite3";

/** Static CLI-only configuration used to generate the D1 migration. */
export const auth = betterAuth({
  baseURL: "https://dev.dongo.so/api/auth",
  basePath: "/api/auth",
  secret: "schema-generation-only-secret-not-used-at-runtime",
  database: new Database(":memory:"),
  user: {
    additionalFields: {
      convexProfileId: { type: "string", required: false, input: false },
      activeProjectRef: { type: "string", required: false, input: false },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      scopes: [
        "dongo:work:read",
        "dongo:work:write",
        "dongo:attachments:read",
        "offline_access",
      ],
      resources: ["https://dev.dongo.so/api/agent/v1"],
      enforcePerClientResources: false,
      grantTypes: [
        "authorization_code",
        "refresh_token",
        DEVICE_CODE_GRANT_TYPE,
      ],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    oauthDeviceAuthorization({ verificationUri: "https://dev.dongo.so/device" }),
    cimd({
      fetchClientMetadataResource: async () => new Response(null, { status: 404 }),
      metadataProfile: "mcp-2026-07-28",
    }),
  ],
});
