# Farmer registration & verification

How registration works, what it collects, and why. Written for developers
joining the project.

---

## The journey

```
Language  →  Mobile  →  OTP  →  New / returning?
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
              new farmer                        returning farmer
                    │                                   │
              Start (name)                    resume at the right step,
                    │                          or see status if submitted
                    ▼
   Personal → Address → Land → Documents → Photo → Review → Submit → Status
```

Each step saves to the server as you leave it. Closing the app and coming back
— on any device — resumes at the first incomplete step.

---

## Authentication is not verification

Two different questions, deliberately kept apart:

| | Question | Mechanism |
|---|---|---|
| **Authentication** | Can this person use this mobile number? | Supabase phone OTP |
| **Verification** | Has this farmer submitted enough, and has an officer confirmed it? | Registration state machine + component checks |

Passing OTP proves control of a phone. It makes nobody a verified farmer.

---

## The state machine

```
DRAFT ──────────► SUBMITTED ──────────► UNDER_REVIEW ──────┬──► VERIFIED
  ▲                   │                                    │
  │                   └──► DRAFT (withdrawn)               ├──► REJECTED ──────┐
  │                                                        │                   │
  └────────────────────────────────────────────────────────┴─ RESUBMISSION_ ───┘
                                                              REQUIRED
                                                                   │
                                                                   ▼
                                                                 DRAFT
```

`VERIFIED` is terminal. `REJECTED` and `RESUBMISSION_REQUIRED` must pass back
through `DRAFT` — there is no direct edge to `SUBMITTED`, so a farmer cannot
resubmit without re-entering the editable state.

**Transitions belong to the backend.** Three independent things enforce it:

1. `registrationService.transition()` checks the table in TypeScript.
2. `app.protect_farmer_registration()` discards `registration_status` written
   by anyone but the service role — on INSERT as well as UPDATE.
3. `app.assert_registration_transition()` refuses an illegal edge from *any*
   writer, the service role included, and stamps `submitted_at` /
   `reviewed_at` / `verified_at` itself rather than trusting the caller.

The TypeScript table (`packages/shared/src/registration.ts`) and the SQL table
are separate implementations of the same rules. `registrationStateMachine.test.ts`
asserts all 36 ordered pairs; `rls.test.ts` proves the database agrees.

### Editable states

`DRAFT`, `REJECTED`, `RESUBMISSION_REQUIRED`. Everything else is locked, and the
lock is a database policy (`app.registration_is_editable`) applied to
`farmer_profiles`, `farmer_land_holdings` and `farmer_documents` — not just an
API check.

---

## What we collect, and why

Every field has a reason. §11 says collect nothing else.

| Field | Why |
|---|---|
| Full name | Identifies the farmer at the centre |
| Name in local script | Optional. Printed records and recognition; **never** a translation of the Latin name |
| Date of birth | Age determines eligibility for several procurement and pension schemes |
| Gender | Women-farmer scheme eligibility reporting. `PREFER_NOT_TO_SAY` exists so it is never forced |
| Residence village / district / state / PIN | Where the farmer lives; routing and correspondence |
| Residence coordinates | Optional. Suggesting a nearby centre later |
| Land: ownership type | Procurement entitlement differs for owners, tenants and sharecroppers |
| Land: area + unit | Determines expected quantity |
| Land: survey number | Optional. Lets an officer match the declaration to the land record |
| Land: village / district | Land is often not where the farmer lives |
| Land: primary crop | Which procurement scheme applies |

**Not collected:** Aadhaar number, income, caste, religion, biometrics.

---

## Residence and land are separate

`farmer_profiles` holds where the farmer *lives*. `farmer_land_holdings` holds
where they *farm*. They are frequently different places, and "use my current
location" while standing in a village is not evidence about a field.

Land is `1..n` from the start — farmers commonly work several parcels under
different arrangements.

---

## Component verification checks

§18 rejects `identityVerified` / `landVerified` / `documentsVerified` booleans.
Instead `farmer_verification_checks` holds one row per check:

```
(farmer_user_id, check_type) → status, reviewed_by, reviewed_at, notes
```

`check_type` is `IDENTITY | ADDRESS | LAND | DOCUMENTS | PHOTO`. Each carries
its own reviewer and reason, so "rejected, and here is why" is expressible.

The table has a `SELECT` policy and **nothing else** — a farmer can read their
own checks and change none of them.

---

## Documents

Stored in the private `farmer-documents` bucket:

```
farmer-documents/<farmer-user-id>/<document-id>/<filename>
```

The first path segment is what the storage policy matches against `auth.uid()`.
No identity number appears in any path or filename, and **storage paths are
never serialised to a client** — `toFarmerDocument()` in `rows.ts` omits them.
Viewing goes through a 2-minute signed URL minted per click.

### Validation

Three things must agree, or the upload is rejected:

1. Declared MIME type is on the allow list
2. File extension matches that MIME type
3. **Leading bytes match too** — a `.pdf` starting with `MZ` is refused

A farmer photograph must additionally be JPEG or PNG; a PDF headshot is a
mistake, not a choice.

### Status

`UPLOADED → UNDER_REVIEW → ACCEPTED | REJECTED | REPLACEMENT_REQUIRED`

Separate from registration status by design: a document being accepted is not
the same as a registration being verified.

### Replacement

Uploading a kind that already exists replaces it. The old row is **superseded,
not deleted** (`superseded_at` set, `replaces_document_id` on the new one), so
the review history of a resubmission survives. A partial unique index enforces
one live document per kind per farmer.

The retirement happens only *after* the new bytes are safely stored, so a failed
upload never leaves a farmer with nothing.

---

## Configurable policy

`document_requirements` decides which documents are required and whether a
photograph is needed. Changing a row changes what registration demands, with no
deploy. Labels are **not** stored there — the table holds a `translation_key`
that resolves against the i18n bundles, so §4 (no hard-coded UI strings) holds.

Turning the photo requirement off removes the photo step from the flow, the
progress indicator, and the submit rules, automatically.

---

## Localisation

`apps/web/src/i18n/` — `en.json`, `ta.json`, and a ~90-line provider. No
framework: the app needs key lookup, `{placeholder}` interpolation and a
language switch that preserves form state.

- English is the reference bundle; a missing Tamil key falls back to English
  rather than rendering blank.
- Switching language never touches form state and **never** re-renders farmer-
  entered data through a translator.
- The choice is stored in `localStorage` and, once signed in, on the profile.
  The in-browser choice wins on load — switching must not be undone by a refresh.
- Language can be changed even while a registration is locked; it is a display
  preference, not registration content.

`localization.test.ts` enforces key parity, placeholder parity, no blanks,
enum coverage, and that Tamil actually contains Tamil script.

### Blocking reasons are keys, not sentences

`evaluateCompleteness()` returns i18n keys (`registration.blocking.land`), never
English prose — a farmer reading Tamil must not be handed an English error.
There is a test for it.

---

## Save & resume

- `current_step` — where the farmer was, written as they navigate
- `last_saved_at` — stamped by a trigger on every farmer-side write
- Completed sections persist server-side immediately

`resolveResumeStep()` prefers the stored step when it is still incomplete
(so a farmer lands where they left off) and otherwise jumps to the first
incomplete step. It never resumes onto a step that policy has removed.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/farmer/registration` | Everything the UI needs; **404 = new farmer** |
| `POST` | `/api/farmer/registration` | Start a DRAFT |
| `PUT` | `/api/farmer/profile` | Personal details |
| `PUT` | `/api/farmer/address` | Residence |
| `GET POST` | `/api/farmer/land` | Land holdings |
| `PUT DELETE` | `/api/farmer/land/:id` | One holding |
| `GET POST` | `/api/farmer/documents` | Documents |
| `GET` | `/api/farmer/documents/:id/url` | Signed URL |
| `DELETE` | `/api/farmer/documents/:id` | Remove an unreviewed document |
| `POST` | `/api/farmer/registration/submit` | Submit for verification |
| `PUT` | `/api/farmer/registration/step` | Save resume position |
| `GET` | `/api/farmer/verification-status` | Farmer-facing status |
| `PUT` | `/api/farmer/language` | Language preference |

Mutating endpoints return the **whole refreshed view**, so the progress
indicator and submit guard always reflect the server's opinion rather than a
locally-guessed one.

---

## Integration boundaries

None of these exist. All are typed placeholders that refuse (§39):

- `AadhaarIdentityProvider` — no UIDAI integration, no simulation, no Aadhaar
  number stored anywhere in the schema
- `StateLandRecordsProvider` — no land-records API
- `UnconfiguredGovernmentDataProvider` — no farmer database, no DigiLocker

What actually runs: `MobileOtpIdentityProvider` (a real check — Supabase
verified the phone) and `ManualLandReviewProvider` (a human decides).

Adding a real integration means writing an implementation of the interface.
Nothing in registration, the schema or the UI changes.

---

## Running the tests

```bash
npm test                              # everything
npm run test:rls -w @kisansetu/api    # integration + RLS only
```

Integration suites need a live Supabase with migrations applied and
`npm run seed:fixtures` run. They **skip themselves with a warning** when
`SUPABASE_*` is unset — a green run that says `skipped` has proven nothing.

### Fixture ownership

Integration suites share fixture accounts, so each one **hard-resets the
farmers it uses** in `beforeAll` via `resetFarmerRegistration()`. That helper
deletes and recreates the `farmer_profiles` row rather than updating the
status, because `VERIFIED` is terminal and the transition trigger refuses to
move out of it even for the service role.

| Suite | Farmers |
|---|---|
| `authorization.test.ts` | A, B |
| `registrationFlow.test.ts` | C |
| `rls.test.ts` | D, E (drives D to VERIFIED) |

No suite depends on the order the files run in.
