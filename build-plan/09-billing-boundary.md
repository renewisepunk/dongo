# planned billing boundary

Status: product preview implemented; checkout, subscription management, and paid activation are deferred.

## accepted product slice

The web product may present a planned **$19 Unlimited** offer with unlimited active projects and unlimited collaborators. Because a billing interval has not been accepted, the UI must show `$19` as a planned price without adding monthly, annual, recurring, or one-time language.

The current organization plan and active-project allowance remain authoritative server data. A Free organization at its allowance sees **Upgrade to add projects** instead of a create action. A Free organization with finite operator-granted capacity keeps **Create another project** and remains labelled Free. Paid organizations keep project creation and are not asked to upgrade.

Until billing is implemented, the upgrade route is informational:

- it does not collect payment details;
- it does not create a checkout or billing-portal session;
- it does not mutate the organization plan or allowance;
- it does not claim that a user has purchased, activated, or reserved the plan;
- it explains that checkout and activation are unavailable.

## future implementation contract

Billing work must preserve the existing organization and project-capacity model rather than introducing a web-only entitlement fork.

1. **Accept commercial terms.** Decide billing interval, taxes, trials, refunds, cancellation timing, delinquency behavior, and whether the price is per organization. Update product and legal copy before enabling checkout.
2. **Add server-owned billing state.** Store provider customer/subscription references and a normalized subscription lifecycle against the organization. Keep secrets and raw provider payloads out of browser-visible data.
3. **Create owner-authenticated sessions.** Only an authenticated organization owner may request a checkout or billing-portal session. The server must derive organization, price, success URL, and cancellation URL; the browser must not supply authoritative entitlement fields.
4. **Activate from verified provider events.** A successful browser redirect is not proof of payment. Verify webhook signatures, process events idempotently, tolerate reordering and retries, and change plan capacity only from confirmed server-side subscription state.
5. **Handle the full lifecycle.** Define behavior for incomplete payment, active, trialing, past due, cancellation at period end, cancellation, refunds, disputes, and provider outages. Preserve existing projects on downgrade and block only new creation until usage returns within allowance.
6. **Add observability and recovery.** Record correlation-safe billing events, alert on webhook lag or repeated failures, provide an audited reconciliation job, and document rollback that can disable new checkout without corrupting current entitlements.
7. **Prove environment boundaries.** Use separate development and production provider accounts, webhook secrets, prices, and return origins. Never expose an environment selector to released clients.

## release gates for billing activation

- Unit tests cover normalized subscription transitions, idempotency, event reordering, and entitlement derivation.
- Integration tests use signed provider fixtures and prove owner/member authorization boundaries.
- Browser journeys cover checkout start, cancellation, success-before-webhook, activation-after-webhook, billing portal, and bounded provider failures.
- Compatibility tests prove CLI, MCP, HTTPS, and web all observe the same project allowance after plan changes.
- Development acceptance verifies the exact candidate against provider test mode, including downgrade and recovery.
- Production promotion follows the production runbook with webhook health, smoke checks, reconciliation, and rollback ready.

The adjacent administration and limits work may add usage analytics, super-admin controls, task limits, or internal billing visibility. Those capabilities must consume the same authoritative plan and allowance state, but they do not authorize checkout or plan activation by themselves.
