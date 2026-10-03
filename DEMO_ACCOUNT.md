# Prototype Demo Account (fixed farmer OTP)

A **Demo Account** box on the Farmer login screen with a fixed OTP, so a live
prototype demonstration never depends on a real SMS reaching a real handset.

| | |
|---|---|
| Demo phone number | `9999999999` |
| Demo OTP | `123456` |
| Applies to | the Farmer / Animal Owner role **only** |
| Ships | **disabled** (`DEMO_MODE=false`) |

Everything else about farmer login is unchanged: farmers are still OTP-only,
the demo code is stored as a salted + peppered hash in a normal, expiring,
single-use OTP row, the session JWT is minted by the same `make_token()` as a
real farmer login, and Vet / Government / Laboratory keep their original
password login and dashboards untouched.

---

## 1. How to enable it on your prototype deployment

### Local development

```bash
cd backend
export DEMO_MODE=true
python app.py          # or: gunicorn app:app --bind 0.0.0.0:5001
```

No SMS gateway is required: the demo number never triggers an SMS, and the
login screen no longer shows the "OTP login is unavailable" warning.

> Keep `OTP_PEPPER` (or `SIH_SECRET_KEY`) set to a **stable** value even in demo
> mode. The fixed code is stored as a peppered hash; an ephemeral per-process
> pepper breaks verification as soon as more than one worker is running.

### A public prototype deployment (Render or similar)

A process that identifies as production (`RENDER=true`, or
`FLASK_ENV=production` / `APP_ENV=production`) ignores `DEMO_MODE` on its own.
It needs a **second, explicit** opt-in, so a fixed OTP can never be switched on
by accident:

```bash
DEMO_MODE=true
DEMO_MODE_ALLOW_PRODUCTION=true
```

The backend logs a loud, secret-free warning at startup whenever the demo
account is live, and `GET /api/health` reports `demo_mode.enabled` so you can
confirm the state of a deployment at a glance.

If your prototype is reachable by the public internet, treat the demo account
exactly like a shared password: it is a documented, fixed credential, so
restrict access to the deployment (basic auth, an allow-list, or a separate
Render preview service) and turn it off when the demonstration is over.

### Verify it is working

```bash
curl -s localhost:5001/api/health | python -m json.tool | grep -A5 demo_mode
# "enabled": true

# Full farmer login, exactly as the browser does it:
curl -s -X POST localhost:5001/api/auth/farmer/request-otp \
     -H 'Content-Type: application/json' -d '{"mobile":"9999999999"}'
curl -s -X POST localhost:5001/api/auth/farmer/verify-otp \
     -H 'Content-Type: application/json' \
     -d '{"mobile":"9999999999","otp":"123456"}'   # -> {"token": ..., "user": {"role":"owner"}}
```

The farmer login screen now shows the **Demo Account** box with the number and
the OTP, plus a **Use Demo Account** button that fills the number in.

---

## 2. How to disable it before public production use

Set **both** variables back to `false` and restart the process (the flag is read
on every request, so a restart is only needed to clear the startup banner):

```bash
DEMO_MODE=false
DEMO_MODE_ALLOW_PRODUCTION=false
```

`render.yaml` and `.env.example` both ship with `false`, so a fresh deploy is
never in demo mode.

After disabling, the fixed OTP is rejected by the ordinary authentication
rules: `POST /api/auth/farmer/verify-otp` with `9999999999` / `123456` returns
`401 OTP_INVALID` (there is no OTP row for that number at all), the Demo
Account box disappears from the login screen, and the existing farmer SMS OTP
flow is exactly as it was.

To remove the demo farmer record from a database entirely:

```sql
DELETE FROM users WHERE role='owner' AND mobile IN ('9999999999','+919999999999');
```

---

## 3. Configuration reference

| Variable | Default | Meaning |
|---|---|---|
| `DEMO_MODE` | `false` | Master switch for the Demo Account box and the fixed OTP. |
| `DEMO_MODE_ALLOW_PRODUCTION` | `false` | Second opt-in required when the process is production. |
| `DEMO_FARMER_MOBILE` | `9999999999` | The one number the demo OTP is ever issued to. |
| `DEMO_FARMER_OTP` | `123456` | The fixed code. Shown on screen; stored only as a hash. |
| `DEMO_FARMER_NAME` | `Demo Farmer` | Display name of the demo farmer profile. |
| `DEMO_FARMER_DISTRICT` / `_VILLAGE` / `_BLOCK` | `Pune` / `Demo Village` / `Haveli` | Demo farmer profile fields. |
| `DEMO_FARMER_EMAIL` | *(derived from the number)* | Optional non-routable placeholder. |

Any unrecognised value (`maybe`, `2`, …) is treated as **disabled** and logged.

---

## 4. Safety model

* **Not a second auth system.** The fixed code is never compared against a
  request body. A real `otp_codes` row is created for the demo number, with the
  normal PBKDF2 + pepper hash, TTL, attempt counter, and single-use
  consumption. Verification runs through the unchanged `verify_otp()`, and the
  JWT comes from the unchanged `make_token()`.
* **Not automatic.** The row only exists because a `request-otp` for that
  number was approved by the demo-mode check. Posting `123456` straight to
  `verify-otp` is rejected with the ordinary `OTP_INVALID` rules.
* **Scoped to one number.** The fixed code is never issued to any other number,
  and never authenticates a Vet / Government / Laboratory account.
* **No password.** The demo farmer is a normal `role='owner'` row with a
  non-authenticating password hash, so the password login route (which already
  refuses every farmer) can never be used with it.
* **No duplicates.** The account is created once and reused; a number already
  held by a staff account is refused (`503 DEMO_ACCOUNT_UNAVAILABLE`) rather
  than overwritten.
* **No SMS.** The demo number is never messaged — `9999999999` may well be a
  real handset. The API answers `demo: true, sms_sent: false` and the screen
  says so explicitly instead of claiming a delivery.
* **Nothing sensitive is logged.** The code, tokens, passwords and full phone
  numbers never appear in a log line, an audit row or `/api/health`; only the
  masked number is recorded.
* **Anti-abuse limits are scoped, not removed.** While demo mode is on, the
  demo number skips the resend cooldown, the per-mobile request cap and the
  failed-verification cap (its code is public by design, and a demonstration
  must not be locked out mid-flow). Every other number keeps the full limits.

---

## 5. Files

| File | Role |
|---|---|
| `backend/demo_auth.py` | The gate, the demo account and the fixed code. |
| `backend/otp_service.py` | Issues the fixed code for the demo number; SMS suppressed. |
| `backend/app.py` | `/api/auth/farmer/config` advertises the box; `/api/health` reports the state. |
| `frontend/app.js` | The Demo Account box, the "Use Demo Account" button, en/mr/hi/te strings. |
| `frontend/style.css` | Styling for the box. |
| `backend/test_demo_account.py` | 29 automated tests for the backend behaviour. |
| `frontend/tests/demo_account_ui.test.mjs` | 11 automated tests for the screen. |

## 6. Tests

```bash
cd backend && python -m pytest test_demo_account.py -v
node --test frontend/tests/
```
