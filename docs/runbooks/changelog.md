# Owner-curated changelog

Completed Work is private by default. An organization owner can use **Public
changelog** in project settings to review completed items in bounded 50-row pages,
edit a public headline and summary, and deliberately publish, update, or
unpublish an entry. **Load older completed Work** keeps older public entries
manageable. The public query returns only the reviewed title, summary, date, and
entry ID; it never returns Work identifiers, goals, outcomes, comments, or files.
The owner editor displays canonical Work identifiers through the shared Work
formatter, including for older records that retain legacy lookup aliases.

The marketing `/changelog` page selects the environment's own project through
`VITE_DONGO_SITE_PROJECT_REF`. The production default is `en8dgh2y-dongo`; the
development default is `p58de816-dongo`. A deliberately empty override displays
the empty state. An unavailable backend displays an error, not a claim that no
entries exist. Deploying the feature never publishes entries.

Publication uses an independent `changelogRevision` on the Work document so
editing public wording does not change the Work execution revision. Publish and
unpublish require the displayed revision and a caller-generated idempotency key.
Retries of the exact operation reuse its key; changed operations use a fresh
key. The revision survives unpublishing, preventing a stale draft from silently
resurrecting an entry. Errors preserve the owner's draft; reload and review the
latest entry before saving a conflicting edit. Every successful change records
an attributed event without copying the public or private text into that event.

Acceptance must prove owner-only access, cross-project denial, private empty
state, explicit synthetic publication/update/unpublish, response-loss replay,
stale writes, and narrow-screen rendering. Never publish real Work as a test.

## What belongs in the public changelog

Consider an entry when a production release gives people a substantial new
capability, materially changes how an existing capability is used, or resolves
a customer-visible limitation important enough to change a buying, setup, or
operating decision. A candidate must be completed, integrated into the shared
target, accepted in development, and verified in production before it can be
published.

Do not publish routine maintenance, internal architecture, dependency or
credential work, operational incident detail, unreleased or partially released
behavior, small visual polish, or a claim whose current production behavior is
still being corrected. Several related implementation items should normally
become one public entry for the capability people receive, not a public copy of
the private Work breakdown.

## Release curation

The release coordinator is accountable for changelog consideration after a
major production release is accepted. The organization owner remains
accountable for the public wording and the final publish, update, or unpublish
decision.

1. Verify each candidate against its exact integrated revision, production
   outcome, and relevant live behavior. Do not draft from a title or private
   discussion alone.
2. Draft a bounded public headline and summary from the user-visible result.
   Exclude Work identifiers, goals, outcomes, comments, attachments,
   credentials, incident detail, and other operational context unless the owner
   deliberately rewrites and approves that information for publication.
3. Put the exact candidate list and wording in dongo Attention on the release
   coordinator Work. The owner must explicitly approve the wording; silence,
   prior approval of the release, and private Work text are not approval to
   publish.
4. After approval, publish through **Public changelog** in project settings,
   then inspect `/changelog` in production and confirm that only the approved
   entries and wording are visible. Record the public page verification on the
   release coordinator Work without copying private material.
5. When no entry is warranted, record `Public changelog: intentionally skipped`
   plus a short, non-sensitive reason on the release coordinator Work before it
   finishes. A skip is a completed decision, not permission to publish later
   without a new review.

Use **Update entry** for corrected public wording and verify the live page
again. Use **Unpublish** when an entry is inaccurate or should no longer be
public; confirm its removal immediately. If the application release itself is
rolled back, re-evaluate every entry that describes the rolled-back behavior
and update or unpublish it rather than leaving a stale public claim.
