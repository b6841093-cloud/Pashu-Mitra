# Pashu-Shield Voice/PBX deployment boundary

## Current status

The repository runs in **MOCK** provider mode by default. `/api/ivr/info` therefore reports `pstn_connected: false`. The browser's `tel:+917382210251` link only opens a native dialer; it does not terminate or bridge a telephone call.

Real PSTN service is **blocked by external telecom provisioning**. The owner of `7382210251` must obtain one of the following legitimate carrier-supported arrangements:

1. native SIP termination for the number;
2. a business voice service that forwards the number to an authenticated SIP trunk;
3. supported number porting to a carrier offering SIP termination; or
4. carrier-supported call forwarding to a separately provisioned SIP DID.

If the number is an ordinary mobile/SIM number, no interception, SS7 manipulation, carrier bypass, or SIM capture is appropriate. A carrier-approved service is required.

## Production topology

```text
Farmer mobile -> 7382210251 -> licensed carrier/PSTN -> SIP trunk
  -> Asterisk/FreeSWITCH on a SIP/RTP-capable host
  -> signed Pashu-Shield IVR webhooks -> Flask business services
  -> PBX bridges to the selected veterinarian
```

The PBX belongs on infrastructure that supports UDP/TCP SIP and a controlled RTP port range. It should **not** be forced onto a normal Render HTTP web service. Render hosts the Flask backend and FastAPI ML service; the PBX is a separate voice workload.

## Webhook contract

All call-state mutation requests use `Content-Type: application/json` and:

- `X-IVR-Timestamp`: current Unix timestamp;
- `X-IVR-Signature`: `sha256=` plus HMAC-SHA256 over `timestamp + "." + raw_body`, using `IVR_WEBHOOK_SECRET`.

Endpoints:

- `POST /api/ivr/calls/inbound` — trusted caller ID and provider call ID;
- `POST /api/ivr/calls/{call_id}/input` — DTMF, language, region, or survey answer;
- `POST /api/ivr/calls/{call_id}/events` — `bridge_connected`, `bridge_failed`, `transcript`, or `hangup`;
- `POST /api/ivr/report` — compatibility endpoint for a completed structured survey.

A bridge request is only an instruction. The backend marks a live connection only after the PBX sends a signed `bridge_connected` event. If bridging fails, the response starts the automated survey.

## Asterisk integration

`asterisk/extensions.conf.example` and `asterisk/pjsip.conf.example` define safe boundaries and placeholders. A production ARI application should:

1. accept only calls delivered by the configured carrier trunk;
2. send carrier-provided caller ID without alteration;
3. play recorded/TTS prompts in the session language;
4. collect DTMF and survey audio;
5. follow the returned provider-independent instruction;
6. bridge only the returned veterinarian target;
7. emit signed bridge/hangup events; and
8. store recordings only when consent, retention, and access controls are configured.

## Security baseline

- SIP TLS and SRTP where carrier-supported;
- long random trunk and ARI credentials stored outside Git;
- carrier IP allowlists and a narrow RTP firewall range;
- disable anonymous SIP and unauthenticated guest calls;
- rate limiting, fail2ban/IDS, log rotation, and timely PBX patching;
- HTTPS webhook egress with certificate verification;
- no public ARI/AMI exposure;
- separate least-privilege service accounts;
- encrypted backups and a documented transcript/recording retention policy.

## PSTN acceptance gate

Do not set both `IVR_PSTN_CONNECTED=true` and `IVR_PSTN_VERIFIED_AT` until a real mobile call to `7382210251` has passed ringing, answer, caller ID (where supplied), DTMF, multilingual prompts, regional routing, two-way audio, vet receipt, persisted call state, report/case creation, notification, government visibility, and GIS validation. Unit or MOCK tests do not satisfy this gate.
