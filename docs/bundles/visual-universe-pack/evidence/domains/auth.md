# W8-D02 — Auth domain audit

## Verified contract

- Manifest/model: `packages/auth/src/manifest.ts` registers only `auth.refresh_token`; no user-facing list/form view or menu is declared.
- UI: actual public consumers are `/login` and `/register` (`apps/board/src/app/login/page.tsx`, `apps/board/src/app/register/page.tsx`). `apps/board/src/components/layout/protected-route.tsx` redirects unauthenticated users to login. No separate session-management screen was found.
- API: `apps/api/src/routes/auth.routes.ts`, registered by `apps/api/src/addons/registry.ts`, owns credential/session operations. Token internals are not a Board record list.
- Access: authentication and session validation are enforced by auth services/routes; no client-side art or invented “locked” status may override those responses.
- Existing assets: canonical security, lock, key, user and mail icons; generic auth/login artwork and empty/error/status components. Use live copy and actual response states.

## Real states and boundaries

The forms can represent idle, submitting and returned invalid/expired/denied/success states where the auth API actually returns them. Do not add remember-me, password-reset or lockout behavior unless an existing route supports it. Artwork is decorative and does not replace labels, validation or status text.

Source review covered the manifest, auth route/service imports and the exact Board pages above. Board typecheck is recorded in the W8-D batch evidence.
