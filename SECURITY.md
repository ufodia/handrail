# Security policy

## Sensitive boundaries

Security-sensitive areas include temporary page permissions, sender/document/token validation, guide JSON and selector validation, trusted-click handling, target matching, private-control exclusions, storage access and safe rendering of imported instructions.

Only current `main` is maintained at this stage. There is no promised response time or long-term support branch.

## Report privately

If repository private vulnerability reporting is enabled, use [Report a vulnerability](https://github.com/ufodia/handrail/security/advisories/new). Do not publish exploit details, private page context or browser-profile data in a public issue.

If that channel is unavailable, ask the maintainer for a private route without posting sensitive information. Include the affected commit, browser/OS, reproduction steps, impact and a minimal synthetic guide/page through the private channel.

## Application boundary

Handrail guides actual user actions; it does not assess whether a website or instruction is trustworthy. A matching target does not prove that clicking it is safe. Imported guide content is rendered as text and replay remains manual. Review files before sharing or following them.

The manifest's three-permission contract and exact sender/progress checks must remain intact during a fix. See [privacy](docs/privacy.md), [architecture](docs/architecture.md) and [reference](docs/reference.md) for implementation scope.
