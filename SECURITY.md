# Security policy

dongo is a cloud coordination service for humans and coding agents. Security reports can affect the public web application, OAuth authorization server, project-scoped MCP gateway, agent API, attachment service, notification service, or npm CLI.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/renewisepunk/dongo/security/advisories/new) for vulnerabilities, suspected credential exposure, or reports that contain customer data. Do not open a public issue for a security vulnerability.

Include only the minimum evidence needed to reproduce the issue:

- affected dongo surface and environment;
- impact and the boundary that was crossed;
- exact reproduction steps;
- whether a credential, project, or attachment was exposed; and
- a safe contact method for follow-up.

Never include active bearer tokens, refresh tokens, authorization codes, signed attachment URLs, one-time codes, or private project content in the report. Revoke any credential that may have been exposed before sending evidence.

We do not publish a guaranteed response or remediation SLA. We will acknowledge and triage complete reports as soon as practical, keep the discussion private while a fix is prepared, and coordinate public disclosure when appropriate.

## Supported version

Security fixes target the currently deployed production service at `https://dongo.so` and the latest code on the default branch. Older local CLI builds may be asked to upgrade before a report can be reproduced or fixed.

## Research boundaries

Good-faith research must avoid privacy violations, service disruption, denial of service, social engineering, destructive actions, and access to data beyond the minimum proof required. Stop immediately if you encounter another user's data or a live credential.

## Security model

The canonical security overview, data-flow boundary, retention matrix, and current assurance limitations are in [`docs/security`](docs/security/README.md). The public version is available at [dongo.so/security](https://dongo.so/security).

