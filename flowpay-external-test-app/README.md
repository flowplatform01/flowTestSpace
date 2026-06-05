# FlowPay External Test App

Standalone sandbox client used to verify that an external product can integrate with FlowPay without exposing secret credentials in the browser.

The app now covers simple credential handoff and realistic merchant lifecycle scenarios:

- online store order checkout.
- subscription invoice payment.
- saved-recipient transfer initialization.
- saved-recipient profile creation through the merchant backend when FlowPay Admin enables recipient provisioning.
- declined payment and checkout recovery.
- unknown saved-recipient guardrails.
- malformed request, forged credential, and idempotency probes.

## Run

```powershell
cd c:\Flow.Ltd\flowpay-external-test-app
node server.mjs
```

Open:

```text
http://127.0.0.1:3025
```

## What It Tests

- The browser does not hold FlowPay secret credentials.
- This app's backend stores the credential handoff values in `.env.local`.
- Customer-facing checkout context is limited to merchant, order, recipient, and payment details.
- Saved-recipient transfers use an explicit `external_recipient_reference` from the merchant backend.
- Saved-recipient setup calls `POST /api/v1/destination-profiles` from the merchant backend with stored FlowPay credentials.
- Recipient payout owners confirm destinations through FlowPay-hosted `/recipient-confirm/:id` links returned to the merchant backend.
- Merchant billing contacts purchase operational credits through `POST /api/credits/purchase` on this backend, which orchestrates FlowPay credit purchase + hosted checkout.
- Invalid credentials and malformed requests are rejected by FlowPay.
- Replayed idempotency keys return the same transaction instead of creating duplicates.
- The backend calls FlowPay:

```text
POST http://localhost:3011/api/v1/payments/initialize
```

with:

```text
x-flowpay-public-key
x-flowpay-secret-key
idempotency-key
```

If the request succeeds, credentials, app access, fees, checkout session creation, and transaction creation are working.

## Validation

```powershell
npm start
node smoke.mjs
npm run test:e2e
```

The browser test suite verifies:

- hosted checkout success and terminal failure states
- saved-recipient provisioning + recipient confirmation + verified transfer
- developer credit balance retrieval, purchase, and settlement
