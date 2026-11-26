---
trigger: always_on
---

# Autonomous Git & Release Governance Lock (Owner Approval Required)

Future agents MUST NOT modify, weaken, bypass, disable, or delete any part of the autonomous Git promotion, release orchestration, or proportional local hook governance without **explicit written approval from the repository owner (`@bjo163`)** in the current user prompt.

## Protected Surfaces

- **Local proportional Git hooks**:
  - `.githooks/pre-commit`
  - `.githooks/pre-push`
  - `.githooks/commit-msg`
  - `scripts/setup-git-hooks.mjs`
- **Autonomous promotion & sync workflows**:
  - `.github/workflows/promote.yml`
  - `.github/workflows/sync-main-to-dev.yml`
  - `.github/workflows/promotion-policy.yml`
  - `scripts/sync-main-to-dev.mjs`
- **Autonomous release orchestration & bootstrap**:
  - `.github/workflows/release-orchestrate.yml`
  - `.github/workflows/release-prepare.yml`
  - `.github/workflows/release.yml`
  - `scripts/release-orchestrator.mjs`
  - `scripts/release-plan.mjs`
- **Repository governance variables**:
  - `AUTONOMOUS_PROMOTE`
  - `AUTONOMOUS_STABLE_RELEASE`
  - `AUTO_HEAL_RETRY`
  - `AUTOMATION_APP_CLIENT_ID`
- **This rule file**:
  - `.agents/rules/autonomous-git-release-lock.md`
  - `.github/CODEOWNERS`

## Enforcement

1. Never alter these files or toggle these repository variables opportunistically during unrelated feature, refactor, or CI-fix tasks.
2. Never add heavy full-repo builds, typechecks, or test suites back into `.githooks/pre-push`; keep local pre-push proportional and diff-scoped while heavy checks stay in CI.
3. If a failure or requirement appears to touch any protected surface above, **stop and request explicit owner approval** before editing.
