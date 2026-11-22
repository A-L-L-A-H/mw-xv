# W8-D01 — Base domain audit

## Verified contract

- Manifest: `packages/orm-base/src/manifest.ts`; models: Country, CountryState, Currency, Language, Company, Bank, Partner, PartnerBank, PartnerCategory, PartnerCategoryLink, PartnerAddress, User, Tag, TagLink, Attachment, Activity, Sequence, AccessGroup, GroupMembership, ModelAccess, CompanyMembership, AuditLog, IrFeatureFlag, SavedFilter, ConfigParameter.
- Metadata views: `packages/orm-base/src/views.ts` defines list/form/search metadata for the base models. Public menus expose partner, company, user, activity, attachment and tag. Technical/localization/finance/related records are marked `developmentOnly`.
- UI: `apps/board/src/app/board/m/[model]/page.tsx` is the generic consumer. Dashboard links in `apps/board/src/components/dashboard/kpi-grid.tsx` target partner, user, company and activity models. No separate people/profile directory was inferred.
- API and permissions: `apps/api/src/addons/registry.ts` registers generic CRUD/bootstrap. `base.ModelAccess`, groups/memberships, company memberships and menu metadata own authorization and visibility; the Board must keep using API-provided access metadata.
- Existing assets: canonical `user`, `users`, `partner`, `company`, `activity`, `attachment`, `tag`, `document`, `file-spreadsheet`, and `archive` icons plus generic empty/offline/access-denied illustrations. No domain-specific portraits are assumed.

## Real states and boundaries

Record empty/loading/error/restricted/unavailable states are UI/API states. People and user images must come from authorized user media or neutral avatars; no fictional profiles. Generic route and model ACLs determine whether a record is visible or editable. Static artwork stays in `packages/assets`.

Sources were read directly from the paths above and `apps/board/src/components/layout/app-shell.tsx`. Board typecheck is recorded in the W8-D batch evidence.
