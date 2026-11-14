# Lending API contract

The Lending Assistant is a single-owner workspace. This API protects owner records, validates write proposals, and records audit events. Financial calculations are intentionally limited until the owner approves the exact interest and payment-allocation rules.

## Owner authentication

The browser must never receive or store the owner secret.

- Store a strong random secret in the Cloudflare Worker secret named `OWNER_API_TOKEN`.
- `POST /api/auth/login` accepts JSON `{ "password": "..." }` over HTTPS.
- A successful login returns an HttpOnly, Secure, SameSite=Strict cookie named `lending_session`, signed by the Worker and valid for eight hours.
- `GET /api/auth/session` checks the session.
- `POST /api/auth/logout` clears the browser cookie.
- Authenticated API calls use the cookie automatically when same-origin. Legacy bearer authentication remains available for trusted server-to-server calls only.
- Mutating requests reject a mismatched Origin header.

Do not use a real passphrase in local commits, fixtures, screenshots, prompts, or frontend environment variables. The secret must be configured later in the Cloudflare Worker settings. Login is not available until that secret exists.

## Prepare, review, and confirm

Every write uses two steps. Preparing an action creates only a pending review record; it does not write the borrower, loan, or payment.

1. Send `POST /api/actions/prepare` with an action type and validated payload.
2. Display the proposed details to the owner.
3. Only after explicit approval, send `POST /api/actions/{actionId}/confirm`.
4. A pending action expires after 15 minutes and can be confirmed only once.

Supported action types:

- `create_borrower`
- `create_loan`
- `record_payment`

Example borrower preparation:

```json
{
  "type": "create_borrower",
  "payload": {
    "fullName": "Juan Dela Cruz",
    "phone": "09xxxxxxxxx",
    "notes": ""
  }
}
```

Example loan preparation:

```json
{
  "type": "create_loan",
  "payload": {
    "borrowerId": "existing-borrower-id",
    "principalMinor": 1000000,
    "currency": "PHP",
    "interestType": "none",
    "interestValue": 0,
    "interestPeriod": "one_time"
  }
}
```

Example payment preparation:

```json
{
  "type": "record_payment",
  "payload": {
    "loanId": "existing-loan-id",
    "amountMinor": 50000,
    "paidAt": "2026-11-14T09:00:00.000Z"
  }
}
```

Money amounts ending in `Minor` are integer centavos (100 centavos = ₱1). The API stores the supplied interest type, value, and period but deliberately does not calculate interest. Fixed-interest units, percentage basis, compounding, rounding, term dates, and payment allocation need explicit owner decisions first.

## Read-only collections

- `GET /api/borrowers`
- `GET /api/loans`
- `GET /api/payments`

All require owner authentication. These endpoints return stored records and do not infer outstanding balances.

## AI assistant

`POST /api/assistant` requires owner authentication and accepts 1–20 conversation messages (each up to 4,000 characters). Optional `language` may be `en`, `tl`, or `tl-en`.

The response contains `intent`, `message`, `proposedActions`, and `needsClarification`. Every proposal must include `requiresConfirmation: true`. The AI endpoint does not write to D1. Model output is untrusted and must pass through the normal prepare/confirm flow. The frontend now presents proposal details and requires a separate owner confirmation before saving.

The Worker uses the Cloudflare Workers AI binding and `@cf/meta/llama-3.1-8b-instruct`. If AI is unavailable or returns invalid output, the endpoint returns an error; regular app controls remain the fallback.

## Current implementation boundaries

- The mobile-first dashboard, borrower/loan/payment views, borrower/loan/payment create forms, AI chat panel, browser voice input/output foundation, owner login screen, and explicit AI proposal review are in the frontend.
- The API supports owner sessions, read-only collections, AI responses, and confirmed create-borrower/create-loan/record-payment actions.
- Edit/archive workflows, advanced reports, configurable repayment schedules, and borrower/loan detail pages still need implementation. The Activity screen reads confirmed audit entries.
- No interest accrual, total payoff, principal allocation, penalties, or due-date calculations are exposed. Do not treat principal less total payments as a real balance until allocation rules are agreed.
- Session cookies are Secure and intended for HTTPS. Production deployment must use same-origin frontend/API routing.
- No Cloudflare resource IDs, secrets, database migrations, or deployment configuration have been applied. Do that only after GitHub implementation and CI are complete.
- Apply database migrations in order before deploying the Worker.
