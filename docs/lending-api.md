# Lending API contract

This module is an owner-only API foundation. It does not calculate interest, balances, penalties, or due dates. Those rules must be agreed before financial summaries are added.

## Authentication

Send the owner token in the HTTP header:

`Authorization: Bearer YOUR_OWNER_API_TOKEN`

Keep the token in a Cloudflare Worker secret named `OWNER_API_TOKEN`. Never commit a real token or place it in browser code.

## Prepare, review, and confirm

All write operations use a two-step flow. Preparing an action does not create a borrower, loan, or payment.

1. Send a `POST /api/actions/prepare` request with an action type and payload.
2. Show the proposed details to the owner.
3. Only after the owner explicitly approves, send `POST /api/actions/{actionId}/confirm`.
4. A pending action expires after 15 minutes and can be confirmed only once.

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

Money amounts ending in `Minor` are integer centavos (for PHP, 100 centavos = ₱1). The API stores the supplied interest type, value, and period but deliberately does not calculate interest. Fixed-interest units, percentage basis, compounding, rounding, and payment allocation need explicit owner decisions first.

## Read-only collections

- `GET /api/borrowers`
- `GET /api/loans`
- `GET /api/payments`

All require owner authentication. The API currently returns raw records; it does not infer outstanding balances from them.

## Current limitations

- Single owner token authentication; no user-management screen yet.
- No CORS allow-list or frontend-to-API connection yet.
- The authenticated `POST /api/assistant` endpoint now sends conversation messages to the Cloudflare Workers AI binding and returns a structured assistant response. The model may propose only supported action types; proposals are not saved or executed by this endpoint.
- The frontend must display any proposal for owner review, then submit it to `POST /api/actions/prepare`. The existing backend validation and explicit confirmation endpoint remain mandatory.
- AI chat is API-only for now; the frontend chat interface, voice, interest calculations, balance calculations, and reports are not implemented yet.
- No edit or delete endpoint. Confirmed records are preserved with an audit entry.
- Apply database migrations in order before deploying the Worker.


## AI assistant endpoint

`POST /api/assistant` requires the owner token and accepts 1–20 conversation messages (each up to 4,000 characters). Optional `language` may be `en`, `tl`, or `tl-en`.

Example:

```json
{
  "language": "tl-en",
  "messages": [
    { "role": "user", "content": "Gusto kong mag-record ng payment." }
  ]
}
```

The response is structured as `intent`, `message`, `proposedActions`, and `needsClarification`. Every proposed action must include `requiresConfirmation: true`. The endpoint does not write to D1. A proposed action is untrusted model output and must be shown to the owner, then passed through the normal prepare/confirm flow. The model is instructed not to calculate financial figures or invent missing IDs or interest terms.

The Worker uses the configured Cloudflare Workers AI binding and the `@cf/meta/llama-3.1-8b-instruct` model. If AI is unavailable or returns an invalid response, the endpoint returns an error and regular app controls remain the fallback.
