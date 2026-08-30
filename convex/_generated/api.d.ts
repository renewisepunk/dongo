/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as dev_bootstrap from "../dev/bootstrap.js";
import type * as dev_bootstrapAction from "../dev/bootstrapAction.js";
import type * as dev_brandMigration from "../dev/brandMigration.js";
import type * as domains_artifacts_index from "../domains/artifacts/index.js";
import type * as domains_attachments_actions from "../domains/attachments/actions.js";
import type * as domains_attachments_index from "../domains/attachments/index.js";
import type * as domains_attachments_summary from "../domains/attachments/summary.js";
import type * as domains_attention_index from "../domains/attention/index.js";
import type * as domains_comments_index from "../domains/comments/index.js";
import type * as domains_events_index from "../domains/events/index.js";
import type * as domains_human_summary from "../domains/human/summary.js";
import type * as domains_identity_assertions from "../domains/identity/assertions.js";
import type * as domains_identity_index from "../domains/identity/index.js";
import type * as domains_installations_actions from "../domains/installations/actions.js";
import type * as domains_installations_index from "../domains/installations/index.js";
import type * as domains_installations_serviceCredentialSecurity from "../domains/installations/serviceCredentialSecurity.js";
import type * as domains_intake_index from "../domains/intake/index.js";
import type * as domains_notifications_dispatcher from "../domains/notifications/dispatcher.js";
import type * as domains_notifications_index from "../domains/notifications/index.js";
import type * as domains_notifications_service from "../domains/notifications/service.js";
import type * as domains_overview_index from "../domains/overview/index.js";
import type * as domains_projects_actions from "../domains/projects/actions.js";
import type * as domains_projects_index from "../domains/projects/index.js";
import type * as domains_search_index from "../domains/search/index.js";
import type * as domains_sync_index from "../domains/sync/index.js";
import type * as domains_work_index from "../domains/work/index.js";
import type * as domains_work_service from "../domains/work/service.js";
import type * as gateway_httpActions from "../gateway/httpActions.js";
import type * as gateway_outbound from "../gateway/outbound.js";
import type * as gateway_readModels from "../gateway/readModels.js";
import type * as gateway_security from "../gateway/security.js";
import type * as http from "../http.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_leases from "../lib/leases.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_validators from "../lib/validators.js";
import type * as maintenance from "../maintenance.js";
import type * as testing_fixtures from "../testing/fixtures.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crons: typeof crons;
  "dev/bootstrap": typeof dev_bootstrap;
  "dev/bootstrapAction": typeof dev_bootstrapAction;
  "dev/brandMigration": typeof dev_brandMigration;
  "domains/artifacts/index": typeof domains_artifacts_index;
  "domains/attachments/actions": typeof domains_attachments_actions;
  "domains/attachments/index": typeof domains_attachments_index;
  "domains/attachments/summary": typeof domains_attachments_summary;
  "domains/attention/index": typeof domains_attention_index;
  "domains/comments/index": typeof domains_comments_index;
  "domains/events/index": typeof domains_events_index;
  "domains/human/summary": typeof domains_human_summary;
  "domains/identity/assertions": typeof domains_identity_assertions;
  "domains/identity/index": typeof domains_identity_index;
  "domains/installations/actions": typeof domains_installations_actions;
  "domains/installations/index": typeof domains_installations_index;
  "domains/installations/serviceCredentialSecurity": typeof domains_installations_serviceCredentialSecurity;
  "domains/intake/index": typeof domains_intake_index;
  "domains/notifications/dispatcher": typeof domains_notifications_dispatcher;
  "domains/notifications/index": typeof domains_notifications_index;
  "domains/notifications/service": typeof domains_notifications_service;
  "domains/overview/index": typeof domains_overview_index;
  "domains/projects/actions": typeof domains_projects_actions;
  "domains/projects/index": typeof domains_projects_index;
  "domains/search/index": typeof domains_search_index;
  "domains/sync/index": typeof domains_sync_index;
  "domains/work/index": typeof domains_work_index;
  "domains/work/service": typeof domains_work_service;
  "gateway/httpActions": typeof gateway_httpActions;
  "gateway/outbound": typeof gateway_outbound;
  "gateway/readModels": typeof gateway_readModels;
  "gateway/security": typeof gateway_security;
  http: typeof http;
  "lib/authz": typeof lib_authz;
  "lib/errors": typeof lib_errors;
  "lib/events": typeof lib_events;
  "lib/idempotency": typeof lib_idempotency;
  "lib/leases": typeof lib_leases;
  "lib/plans": typeof lib_plans;
  "lib/validators": typeof lib_validators;
  maintenance: typeof maintenance;
  "testing/fixtures": typeof testing_fixtures;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
