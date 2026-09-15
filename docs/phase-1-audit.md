# Phase 1 — repository audit & cleanup report

Produced before implementation, per Phase 1 §2 and §46 Step 1.

There is no SQLite/Prisma runtime in this repository (Phase 0 was built greenfield
on Supabase), so the parts of §2 covering Prisma removal and old-persistence
cleanup have nothing to act on. Everything else is classified below.

---

## 1. Demo / prototype behaviour to remove (§2)

Phase 0 deliberately shipped demo affordances. Phase 1 says the normal
application must contain none of them. All of the following leave the
user-facing product; test fixtures survive only inside test tooling.

| Location | What it is | Action |
| --- | --- | --- |
| `apps/web/src/components/OtpLoginForm.tsx` → `DemoNumbers` | Clickable "demo number" chips on every login screen | **REMOVE** |
| `apps/web/src/components/OtpLoginForm.tsx` → `DEMO_NUMBERS` | Hard-coded demo phone list in the UI bundle | **REMOVE** |
| `apps/web/src/lib/env.ts` → `demoMode` | `VITE_DEMO_MODE` read by the UI | **REMOVE** |
| `apps/web/src/vite-env.d.ts` → `VITE_DEMO_MODE` | Type for the above | **REMOVE** |
| `apps/api/src/config/env.ts` → `DEMO_MODE` | Server demo flag | **REMOVE** |
| `packages/shared/src/models.ts` → `FarmerVerificationView.demoVerification` | Flag that drove a "Demo verification" banner | **REMOVE** |
| `apps/web/src/pages/farmer/FarmerVerification.tsx` → demo banner | "Demo verification" copy shown to farmers | **REPLACE** with honest status wording (§14, §42) |
| `apps/api/src/scripts/demoAccounts.ts` | Demo account roster imported by the seed | **RELOCATE** to `apps/api/tests/fixtures/` — test tooling only |
| `apps/api/src/scripts/seed.ts` | Seeds demo accounts; also the only source of reference data | **SPLIT**: reference data (states/districts/centres) stays a real operational seed; account fixtures move to test tooling |
| `.env` / `.env.example` → `DEMO_MODE`, `VITE_DEMO_MODE` | Demo switches | **REMOVE** |
| `README.md` → "Demo accounts" section | User-facing demo instructions | **REWRITE** as a test-fixtures note |

`supabase/config.toml` `[auth.sms.test_otp]` and the hosted project's test
numbers are **KEEP** — they are Supabase-side test configuration, never
referenced by application code, and they are what lets the test suite run. They
are documented as test infrastructure, not as a product feature.

---

## 2. Phase 0 code that Phase 1 changes

### The verification model is replaced (§18)

Phase 0 modelled verification as three columns on `farmer_profiles`:
`identity_verification_status`, `land_verification_status`,
`document_verification_status`, with an overall status derived by trigger.

Phase 1 §18 rejects exactly this shape — "do not create arbitrary boolean flags
such as identityVerified / landVerified / documentsVerified … if component
verification is required, model it explicitly as verification checks."

| Item | Action |
| --- | --- |
| Three `*_verification_status` columns | **REMOVE** (migration 0009) |
| `app.derive_verification_status()` trigger | **REMOVE** |
| New `farmer_verification_checks` table | **NEW** — one row per check, explicit `check_type`, own reviewer/notes |
| New `registration_status` on `farmer_profiles` | **NEW** — the state machine of §33 |
| `deriveOverallVerificationStatus()` in shared | **REPLACE** with state-machine transition rules |

### Everything else in Phase 0 is sound and stays

| Area | Action | Note |
| --- | --- | --- |
| `middleware/auth.ts`, `authorization.ts` | **KEEP** | Already satisfies §29 |
| `lib/supabase.ts` / `supabaseAdmin.ts` | **KEEP** | Client separation satisfies §31 |
| `middleware/errorHandler.ts`, `requestId.ts`, `validation.ts` | **KEEP** | Satisfies §24's "never expose internals" |
| `services/audit/auditService.ts` | **REFACTOR** | Add the §30 action names |
| `repositories/*` | **REFACTOR** | Extend for new tables; layering already matches §25 |
| `services/documents/documentService.ts` | **REFACTOR** | Add replacement chain, new status enum, progress-friendly errors |
| `identityVerificationProvider.ts` | **KEEP** | Already the §39 adapter shape; add `LandVerificationProvider` alongside |
| RLS policies, column guards, storage policies | **KEEP + EXTEND** | Satisfy §28 already |
| `pages/farmer/FarmerOnboarding.tsx` | **REPLACE** | Single-page form; §6 requires stepped flow |
| `components/OtpLoginForm.tsx` | **REFACTOR** | De-demo, localise |
| Staff / district / state dashboards | **KEEP** | Out of Phase 1 scope (§49); left untouched |

---

## 3. New for Phase 1

- `apps/web/src/i18n/` — `en.json`, `ta.json`, typed provider (§4)
- Stepped registration flow, 10 screens (§34, §41)
- `farmer_land_holdings` table — land is modelled separately from residence (§12, §13)
- `farmer_verification_checks` table (§18)
- `document_requirements` table — configurable required documents and photo policy (§14, §15)
- Registration state machine with backend-only transitions (§33)
- Save/resume via `current_step` + `last_saved_at` (§21)
- `/api/farmer/*` endpoints (§32)

---

## 4. Deliberate decisions

**Residence and land are separate.** §12 requires it. Residence lives on
`farmer_profiles`; land lives in `farmer_land_holdings`, which also carries its
own verification status so §14's `DOCUMENT_SUBMITTED` ≠ `LAND_VERIFIED`
distinction is structural rather than a naming convention.

**Multiple land holdings are supported.** Farmers commonly work several parcels.
The table models `1..n` from the start; the UI manages a list.

**Date of birth and gender are collected**, against §11's "only what is
genuinely required". Both have a stated business reason: age determines
eligibility for several procurement and pension schemes, and gender is required
for women-farmer scheme reporting. Both are recorded in the field-purpose table
in `docs/phase-1-registration.md`.

**The farmer photo is a document**, not a special column — type `FARMER_PHOTO`
in `farmer_documents`. It reuses the private bucket, signed URLs and review
workflow, and §15's "a photo is a submitted artifact, not identity
verification" is then true by construction.
