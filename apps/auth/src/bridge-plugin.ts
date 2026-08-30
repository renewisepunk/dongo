import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";
import type { AuthWorkerEnv } from "./env";
import {
  safeReturnTo,
  verifyHumanBridgeAssertion,
  type HumanBridgeClaims,
} from "./security";

async function consumeAssertion(
  env: AuthWorkerEnv,
  claims: HumanBridgeClaims,
): Promise<void> {
  const expiresAt = (claims.exp ?? 0) * 1_000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw new APIError("UNAUTHORIZED", {
      message: "Human bridge assertion has expired",
    });
  }
  try {
    await env.AUTH_DB.prepare(
      "INSERT INTO dongoBridgeAssertion (jti, profileId, expiresAt, consumedAt) VALUES (?, ?, ?, ?)",
    )
      .bind(claims.jti, claims.profileId, expiresAt, Date.now())
      .run();
  } catch {
    throw new APIError("UNAUTHORIZED", {
      message: "Human bridge assertion has already been used",
    });
  }
}

async function verifiedClaims(
  env: AuthWorkerEnv,
  token: string,
): Promise<HumanBridgeClaims> {
  let claims: HumanBridgeClaims;
  try {
    claims = await verifyHumanBridgeAssertion({
      token,
      secret: env.HUMAN_ASSERTION_SECRET,
      issuer: env.HUMAN_ASSERTION_ISSUER,
      audience: `${env.AUTH_ISSUER}/dongo/bridge`,
    });
  } catch {
    throw new APIError("UNAUTHORIZED", {
      message: "Human bridge assertion is invalid",
    });
  }
  await consumeAssertion(env, claims);
  return claims;
}

export function dongoHumanBridge(env: AuthWorkerEnv): BetterAuthPlugin {
  return {
    id: "dongo-human-bridge",
    endpoints: {
      bridgeHumanSession: createAuthEndpoint(
        "/dongo/bridge",
        {
          method: "POST",
          body: z.object({ assertion: z.string().min(32) }),
          metadata: { noStore: true },
        },
        async (ctx) => {
          const claims = await verifiedClaims(env, ctx.body.assertion);
          const existing = await ctx.context.internalAdapter.findUserById(
            claims.profileId,
          );
          const emailMatch = await ctx.context.adapter.findOne<{
            id: string;
          }>({
            model: "user",
            where: [{ field: "email", value: claims.email }],
          });
          if (emailMatch && emailMatch.id !== claims.profileId) {
            throw new APIError("CONFLICT", {
              message: "This email is linked to another dongo identity",
            });
          }

          const user = existing
            ? await ctx.context.internalAdapter.updateUser(existing.id, {
                email: claims.email,
                emailVerified: true,
                name: claims.name,
                convexProfileId: claims.profileId,
                ...(claims.projectRef
                  ? { activeProjectRef: claims.projectRef }
                  : {}),
                updatedAt: new Date(),
              })
            : await ctx.context.internalAdapter.createUser(
                {
                  id: claims.profileId,
                  email: claims.email,
                  emailVerified: true,
                  name: claims.name,
                  convexProfileId: claims.profileId,
                  activeProjectRef: claims.projectRef,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
                { method: "dongo-human-bridge" },
              );
          if (!user) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not establish the authorization session",
            });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not establish the authorization session",
            });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            ok: true,
            redirectTo: safeReturnTo(claims.returnTo, env.PUBLIC_ORIGIN),
          });
        },
      ),
      selectDongoProject: createAuthEndpoint(
        "/dongo/select-project",
        {
          method: "POST",
          body: z.object({ assertion: z.string().min(32) }),
          use: [sessionMiddleware],
          metadata: { noStore: true },
        },
        async (ctx) => {
          const claims = await verifiedClaims(env, ctx.body.assertion);
          const authenticated = ctx.context.session?.user as
            | { id?: string; convexProfileId?: string }
            | undefined;
          if (
            !authenticated ||
            authenticated.id !== claims.profileId ||
            authenticated.convexProfileId !== claims.profileId ||
            !claims.projectRef
          ) {
            throw new APIError("FORBIDDEN", {
              message: "Project selection does not match this dongo session",
            });
          }
          await ctx.context.internalAdapter.updateUser(claims.profileId, {
            activeProjectRef: claims.projectRef,
            updatedAt: new Date(),
          });
          return ctx.json({ ok: true, projectRef: claims.projectRef });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
