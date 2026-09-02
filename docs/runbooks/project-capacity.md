# Project capacity overrides

The standard Free allowance is one active project per organization. Deployment
operators may grant an existing organization a finite additional allowance
without changing its plan or storage quota. The override is resolved through an
existing owner account's normalized email address, stored on that organization,
revision checked, and recorded as an immutable system event without storing the
email in event data.

This remains a deployment-admin operation for command-line operators. The
private, server-authorized super-admin web route uses the same write helper and
`projectCapacityRevision`; there is no organization-owner, CLI, MCP, or agent
mutation for changing capacity.

## Inspect before changing

The account must already exist in dongo and own the target organization. If it
owns more than one organization, include `organizationSlug` in every request.
Do not provider-normalize addresses by removing dots or `+` suffixes; dongo only
trims and lowercases the exact verified address.

Development:

```sh
npx convex run operators/projectCapacity:inspect '{"email":"owner@example.com"}' --deployment wandering-camel-662
```

Production:

```sh
npx convex run operators/projectCapacity:inspect '{"email":"owner@example.com"}' --deployment brainy-camel-172
```

Record the returned organization slug, current usage, effective limit, source,
and revision in the private operational record. Do not paste account email or
other returned identifiers into public tickets or chat.

## Grant or change capacity

Use an integer from 1 through 100 and the exact revision returned by inspection.
Choose a unique non-secret request ID and a concise reason that contains no
customer content or credentials.

```sh
npx convex run operators/projectCapacity:setOverride '{"email":"owner@example.com","activeProjectLimit":5,"expectedRevision":0,"reason":"approved additional project capacity","requestId":"capacity-20260901-001"}' --deployment wandering-camel-662
```

Verify development first. After the exact application revision and operator
function have passed the development acceptance review and been promoted, repeat
the inspection and an independently revision-checked change in production:

```sh
npx convex run operators/projectCapacity:setOverride '{"email":"owner@example.com","activeProjectLimit":5,"expectedRevision":0,"reason":"approved additional project capacity","requestId":"capacity-20260901-002"}' --deployment brainy-camel-172
```

Never add `--push` to an operator command. Deployment is a separate reviewed
release action. A revision conflict means another operator changed capacity;
inspect again and reassess instead of retrying blindly.

## Return to the standard allowance

Set `activeProjectLimit` to `null` using the current revision:

```sh
npx convex run operators/projectCapacity:setOverride '{"email":"owner@example.com","activeProjectLimit":null,"expectedRevision":1,"reason":"return to standard Free allowance","requestId":"capacity-20260901-003"}' --deployment brainy-camel-172
```

Lowering or clearing an override never archives or deletes projects. If current
usage exceeds the new allowance, existing projects remain active and creation or
unarchive operations stay blocked until usage is within the effective limit.

## Verification

1. Inspect again and confirm plan `free`, source `operator_override` when set,
   the requested finite limit, and the incremented revision.
2. Sign in as the affected owner and confirm onboarding, CLI approval, and Plan
   & storage show the same finite allowance and “Additional capacity granted.”
3. Create only the authorized test project. Confirm the next creation is blocked
   when the allowance is full.
4. Confirm storage remains at the Free quota and no UI claims a Paid plan.
