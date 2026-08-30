import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import { sendOtpEmail } from "./gateway/outbound";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleConfigured = Boolean(googleClientId && googleClientSecret);
  return {
    appName: "dongo",
    baseURL: process.env.CONVEX_SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
          },
        }
      : {},
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        storeOTP: "hashed",
        resendStrategy: "rotate",
        rateLimit: { window: 60, max: 3 },
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in" && type !== "email-verification") {
            throw new Error("Unsupported dongo email OTP type");
          }
          await sendOtpEmail({ email, otp, type });
        },
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig, jwksRotateOnTokenGenerationError: true }),
    ],
  } satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));
