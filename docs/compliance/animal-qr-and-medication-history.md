# Animal QR scanning, medication history and portal navigation

This note records the targeted enhancements for animal QR scanning, chronological
medication history with photographs, timestamps, portal naming and the Farmer
Login initial route. The existing Pashu-Mitra UI and architecture are preserved.

## QR workflow

1. A farmer signs in with the existing mobile OTP flow.
2. **My Livestock** exposes **Scan Animal QR** (`#/owner/scan`).
3. The browser requests camera permission when **Start Scanner** is pressed.
4. A live camera feed (BarcodeDetector, with `/api/qr/decode` fallback) reads
   the animal tag. Camera tracks are stopped when the scanner closes, when the
   user navigates away, or after a successful read.
5. Duplicate payloads in the same session are ignored (`scanLock`).
6. The scanned value is sent to `GET/POST /api/animals/lookup-qr`.
7. The backend resolves an opaque `PASHU:ANIMAL:<token>` payload or a manual
   animal code / numeric id. Private medical data, phone numbers, passwords and
   JWTs are never stored in the QR payload.
8. `GET /api/animals/<id>` enforces ownership: another farmer receives `403`
   with `code: UNAUTHORIZED`. Unknown identifiers return `404` /
   `ANIMAL_NOT_FOUND`. Malformed or sample QR codes return `400` / `INVALID_QR`.
9. On success the existing animal details page opens.

Manual Animal ID lookup and QR image upload remain available when the camera is
denied, missing or fails.

QR generation already existed (`animal_qr_codes`, `/api/animals/<id>/qr`) and is
reused. New animals still receive an opaque `PASHU:ANIMAL:` token at creation.

## Database changes

Additive only. No tables are dropped or rebuilt.

- `animal_medications` gains: `updated_at`, `administered_at` (event time),
  `recorded_at` (entry time), `administration_method`, `reason`, `symptoms`,
  `veterinarian_name`, `next_dose_at`, `follow_up_at`, `source`
  (`farmer` / `vet`), `recorded_by`, `author_role`.
- New table `animal_medication_photos` stores metadata only. Bytes live under
  `backend/uploads/medical/` (outside the frontend static root).
- Safe `updated_at` columns are added to `animals`, `herds`, `prescriptions`,
  `vaccinations`, `lab_reports`, `lab_requests`, `notifications` and `users`
  when missing. Legacy rows keep `NULL` timestamps; historical dates are never
  fabricated.

Migration: `database.ensure_medication_history_schema()`, called from `init_db()`.

## API changes

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/animals/lookup-qr` | Resolve QR / animal code with authz codes |
| GET | `/api/animals/<id>/medications` | Chronological history (newest first) |
| POST | `/api/animals/<id>/medications` | Farmer or vet create (JSON or multipart) |
| PUT | `/api/animals/<id>/medications/<id>` | Edit own eligible record |
| POST | `/api/animals/<id>/medications/<id>/photos` | Attach photographs |
| GET | `/api/animals/<id>/medications/<id>/photos/<id>` | Authorised image bytes |

Farmers can only create/edit records with `source=farmer` that they authored.
Veterinarian-authored rows cannot be overwritten by farmer edits
(`VET_RECORD_LOCKED`). Cross-farmer reads return `403`.

## Upload security

Reuses `compliance_security.validate_upload`:

- JPEG / PNG / WebP only (magic-byte sniff, not client MIME)
- 5 MB default limit
- Executable / double-extension names rejected
- Server-generated `uuid.ext` filenames; client paths ignored
- Files stored outside `FRONTEND_DIR` and served with `nosniff`, `no-store`
- Authorization required; another farmer cannot fetch the bytes

## Timestamp policy

- Creation timestamps are generated on the server (`datetime.utcnow` /
  SQLite `datetime('now')`, UTC).
- Successful edits refresh `updated_at`.
- `administered_at` / `event_at` is when treatment occurred; `created_at` /
  `recorded_at` is when the row was entered.
- The frontend `fmtDate` displays date-only values as dates and datetime values
  as local `09 Oct 2026, 10:30 AM`. Missing values render as `—`.

## Authorization rules

- Farmer OTP, Officer Access, and vet / government / laboratory password login
  are unchanged.
- Root `#/` is Farmer OTP Login. `#/home` is the existing public homepage.
  Authenticated visitors to public login routes still bounce to their dashboard.
- Deep links keep the previous `isPublic` / role checks.
- QR lookup never bypasses animal ownership.

## Portal navigation

English labels:

- Home (`#/home`)
- Farmer Portal
- Veterinary Portal
- Government Portal
- Laboratory Portal
- About Us / Contact / Help

`Disease Info` was removed from the Veterinary Portal dashboard shortcuts.
Disease library APIs and non-veterinary views remain.

## Tests performed

- `backend/test_animal_qr_medication.py` — valid/invalid/unknown/unauthorized QR,
  manual fallback, create/upload/reject/edit/cross-farmer/vet-lock, timestamps.
- `frontend/tests/animal_qr_medication.test.mjs` — portal names, root login,
  `#/home`, i18n, scanner controls, Disease Info removal, `fmtDate`.
- Existing suites via `bash backend/run_tests.sh` and
  `node --test frontend/tests/*.test.mjs`.

## Remaining limitations

- Live camera decoding depends on `BarcodeDetector` or the `/api/qr/decode`
  OpenCV path; headless CI cannot exercise a real camera.
- Browser verification of the hosted preview may be reported separately.
- Legacy rows without `administered_at` show only `created_at` when present.
