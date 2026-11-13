import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";
import {
  account, apikey, invitation, member, organization as organizationTable, session,
  twoFactor as twoFactorTable, user, verification,
} from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";
import { organizationAc, organizationRoles } from "./roles.js";

export function createAuth(input: {
  db: AppDatabase;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}) {
  return betterAuth({
    appName: "Video Agent",
    baseURL: input.baseURL,
    secret: input.secret,
    trustedOrigins: input.trustedOrigins,
    logger: { disabled: true },
    database: drizzleAdapter(input.db, {
      provider: "sqlite",
      schema: {
        user,
        session,
        account,
        verification,
        twoFactor: twoFactorTable,
        apikey,
        organization: organizationTable,
        member,
        invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "member",
          input: false,
        },
      },
    },
    rateLimit: { enabled: true },
    plugins: [
      twoFactor(),
      organization({
        ac: organizationAc,
        roles: organizationRoles,
        creatorRole: "owner",
        allowUserToCreateOrganization: false,
      }),
      apiKey({ rateLimit: { enabled: false } }),
    ],
    advanced: {
      useSecureCookies: false,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
    },
  });
}

export type VideoAgentAuth = ReturnType<typeof createAuth>;
