# Security policy

dongo is a cloud coordination service for people and coding agents. This policy covers the production service, agent connections, and the dongo CLI.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/renewisepunk/dongo/security/advisories/new) for vulnerabilities, suspected credential exposure, or reports that contain customer data. Do not open a public issue for a security vulnerability.

Include only the minimum evidence needed to reproduce the issue:

- what happened and the resulting impact;
- the steps required to reproduce it;
- whether a credential, project, attachment, or customer record was exposed; and
- a safe contact method for follow-up.

Never include active credentials, authorization codes, private project content, or temporary access links in the report. Revoke any access that may have been exposed before sending evidence.

We do not publish a guaranteed response or remediation SLA. We will acknowledge and triage complete reports as soon as practical, keep the discussion private while a fix is prepared, and coordinate public disclosure when appropriate.

## Supported version

Security fixes target the currently deployed production service and the latest dongo CLI. Older CLI builds may need to be upgraded before a report can be reproduced or fixed.

## Research boundaries

Good-faith research must avoid privacy violations, service disruption, denial of service, social engineering, destructive actions, and access to data beyond the minimum proof required. Stop immediately if you encounter another user's data or an active credential.

For dongo's public security and privacy position, visit [dongo.so/security](https://dongo.so/security).
