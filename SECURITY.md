# Security policy

## Password policy

New credentials (registration, password change, and seeded superadmin bootstrap) require 12–1024 characters. Existing accounts created under the former 6-character minimum can still sign in; they must choose a 12-character-or-longer password when changing it.

Passwords are hashed with `scrypt` using `N = 2^17` (131072), `r = 8`, `p = 1`, a fresh 16-byte random salt, and constant-time comparison. Verification remains compatible with previously stored `scrypt$131072$8$1$...` hashes.

## Supported versions

Security fixes target the latest published release. The `main` and `dev` branches are development and integration refs; they are not a promise of a supported deployment or response SLA. Use a supported release and follow its published correction notices.

## Report a vulnerability privately

Do not disclose suspected vulnerabilities in public issues, discussions, pull requests, screenshots, or logs. Use the repository's **Security → Report a vulnerability** flow when private vulnerability reporting is available. If that action is unavailable, contact the repository owner privately through the contact method listed on [the owner profile](https://github.com/bjo163); do not create a public issue containing exploit details.

Include the affected commit or release, impact, prerequisites, reproducible steps, and a safe proof of concept. Remove real tokens, personal data, and production records. Do not test against systems or data you do not own. The maintainers will acknowledge reports as soon as practical, coordinate a fix and disclosure with the reporter, and publish a correction notice when appropriate. There is no guaranteed response time or bounty program.

The repository owner must verify and enable GitHub private vulnerability reporting and configure an actively monitored private contact before claiming this channel is operational. See [the incident-response runbook](docs/operations/security-incident-response.md) for containment and release correction.
