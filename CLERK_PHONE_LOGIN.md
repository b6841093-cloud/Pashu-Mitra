# Farmer mobile OTP login with Clerk

Farmers log in (and sign up) with their mobile number and a 6-digit SMS code.
When `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set, the code is sent
and checked by [Clerk](https://clerk.com). Otherwise the app keeps using the
existing Android SMS Gateway flow (`FARMER_OTP_LOGIN.md`). The farmer screen
looks the same either way, and Clerk is never named in the UI.

Vet, Government and Laboratory logins are unchanged. So is the demo account
(`DEMO_MODE`), which still uses its fixed OTP.

## How it works

1. The farmer screen loads Clerk's browser SDK in the background as soon as it
   opens, so tapping **Send OTP** goes straight to the SMS request.
2. For a number Clerk hasn't seen before, the browser calls
   `POST /api/auth/farmer/phone-start` and the server creates the Clerk user
   with the secret key. That skips Clerk's browser sign-up, along with its
   CAPTCHA and any required-password setting. The browser then does a normal
   Clerk sign-in: Clerk sends the SMS and checks the code, which proves the
   farmer owns the number.
3. The browser posts the short-lived Clerk session token to
   `POST /api/auth/farmer/clerk`.
4. The backend checks the token's signature with Clerk's JWKS (cached, so no
   per-login network call), reads the verified number, then does one of three
   things:
   * existing farmer: issues the normal app JWT
   * unknown number: returns `registration_required` and a single-use
     registration token, and the farmer fills in the existing profile step
     (`/api/auth/farmer/register`)
   * staff number: rejects with `403`

## Setup (free Hobby plan)

1. Create an application at <https://dashboard.clerk.com>.
2. Go to **Configure → User & authentication**:
   * **Phone number**: turn on *Sign-up with phone*, *Verify at sign-up* and
     *Sign-in with phone* using **SMS verification code**.
   * Email and password settings don't matter for farmers, because the server
     creates the Clerk users itself.

3. **Required:** go to **SMS → Settings** and enable **India (+91)**. Only
   the US and Canada are on by default. Until India is on, Clerk rejects every
   +91 number with `unsupported_country_code`, and farmers see "OTP login is not
   available".
4. Open **API keys** and copy the **development** keys (`pk_test_…`,
   `sk_test_…`):
   * local: paste them into `.env` in the project root
   * Render: set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in the service
     environment (already declared in `render.yaml`)
5. Optional speed-up: under **Sessions → Customize session token**, add

   ```json
   { "phone": "{{user.primary_phone_number}}" }
   ```

   The backend then reads the number from the token and skips the Clerk
   Backend API call.
6. Install the new dependency: `pip install -r backend/requirements.txt`
   (PyJWT now uses the `[crypto]` extra for RS256).

### Free plan limits

* SMS on Clerk's free plan only works from a **development** instance
  (`pk_test_`). It allows **20 real SMS per calendar month** to non-US numbers,
  which includes India.
* A production instance (`pk_live_`) needs the paid **Pro** plan for SMS.
* For demos that would go past 20 SMS, use the existing demo account
  (`DEMO_MODE=true`, see `DEMO_ACCOUNT.md`). It sends no SMS.

## Files

| File | Purpose |
|---|---|
| `backend/clerk_auth.py` | Decodes the publishable key, verifies Clerk session tokens (cached JWKS), resolves the verified phone |
| `backend/app.py` | `phone_auth` block in `/api/auth/farmer/config`; `POST /api/auth/farmer/clerk` |
| `backend/otp_service.py` | `issue_external_registration_token()`: single-use signup token for a Clerk-verified number |
| `backend/env_file.py` | Loads `.env` / `backend/.env` without overriding real environment variables |
| `frontend/app.js` | Clerk SDK preload and the send/resend/verify flow, plugged into the existing OTP screen; provider errors are mapped to existing localised messages |
| `backend/test_clerk_login.py` | Tests for the token exchange (login, signup, staff rejection, forged/expired/wrong-issuer tokens) |
