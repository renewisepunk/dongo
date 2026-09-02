# dongo platform administration

The private `/admin` route is available only to a human profile whose stored
platform role is `super_admin`. Convex derives that profile from the current
authenticated identity on every query and mutation. Browser-supplied roles,
organization ownership, emails, usage totals, and revisions are never accepted
as authority. `rene@wisepunk.com` is the initial super-admin account; creating
another platform role requires a separately reviewed data migration.

The dashboard exposes bounded operational aggregates: signup and last-active
times, membership/project counts, total Work usage, and created/closed activity
attributed to the person who performed or authorized it. It never returns Work
titles or descriptions, Intake, comments, attachments, credentials, provider
payloads, or raw billing data. Account activity counters begin when tracking is
enabled. Organization Work totals are backfilled from authoritative Work rows;
`at_least_limit` means the organization has at least 1,000 items and is shown as
a lower bound rather than an exact total.

## development signup allowlist

Only the exact development origin `https://dev.dongo.so` enforces the signup
allowlist. Production and every other origin retain their existing signup
behavior. Existing development accounts may still sign in because the check is
attached only to user creation.

`DONGO_DEV_SIGNUP_ALLOWLIST` is an optional comma-separated list of exact email
addresses. Addresses are trimmed and lowercased; provider-specific dot or plus
normalization is not performed. When unset, the list contains only
`rene@wisepunk.com`. An invalid configured address rejects development account
creation instead of disabling the restriction. Do not put this value or any
credential in the repository.

## Work usage migration

New organizations start with an exact zero counter. Before accepting a release
that enables finite Work allowances, run the bounded migration until it reports
`complete: true` in development, then repeat it as a production release step for
the accepted revision:

```sh
npx convex run maintenance:backfillNextOrganizationWorkItemCount '{}' --deployment wandering-camel-662
```

Each call processes one organization and reads at most 1,001 Work rows. A
one-per-minute maintenance job also drains unmigrated organizations. Counts up
to 1,000 are exact. Larger histories persist a safe 1,000-item lower bound,
which is sufficient to enforce every supported finite allowance without
repeated scans. Do not enable an external finite-limit announcement until the
migration is complete.

## changing allowances

The standard Free allowances are one active project and 250 total Work items.
The total is lifetime creation: closing, cancelling, or archiving Work does not
restore capacity. A super admin may set finite overrides of 1–100 active
projects and 1–1,000 total Work items. Paid organizations keep unlimited active
projects; a finite Work override remains available for operational control.

Inspect the current dashboard row, enter a content-free operational reason, and
save using the displayed project and Work revisions. Project allowance changes
share the same `projectCapacityRevision` and write helper as the deployment
operator command. Work allowance changes use `workCapacityRevision`. A stale
revision is a conflict: inspect the current state and reassess rather than
retrying blindly. Requests are idempotent for 24 hours, and expired records are
removed by bounded maintenance.

Every successful browser change emits a content-free
`organization.allowances_changed` system event. The existing deployment
operator path additionally preserves `organization.project_capacity_changed`
for additive compatibility with audit consumers. Lowering a limit never deletes
or mutates existing projects or Work; new creation remains blocked until usage
is within the effective allowance.

## billing boundary and rollback

`Not configured` is a placeholder, not subscription state. This interface does
not collect payment details, call Stripe, activate Paid, create checkout or
portal sessions, or expose billing secrets. Follow the planned billing boundary
before adding any provider.

To roll back the presentation, remove access to `/admin`; the server role and
additive fields can remain dormant. To roll back an allowance, use a fresh
revision-aware mutation to clear the override. Never repair counters or
revisions manually, and never lower an allowance expecting data deletion.
