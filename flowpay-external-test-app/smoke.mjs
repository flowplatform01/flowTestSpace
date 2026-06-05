const base = "http://127.0.0.1:3025";

const { response: initResponse, payload: initPayload } = await postJsonWithRateLimitRetry(
  `${base}/api/payments/initialize`,
  {
    amount: 10,
    currency: "XAF",
    paymentMethod: "MTN_MOMO",
    customerName: "External Smoke Customer",
    customerEmail: "smoke@example.com",
    customerPhone: "+237677777777",
    externalReference: `smoke-campay-success-${Date.now()}`
  }
);

if (!initResponse.ok || !initPayload.ok || !initPayload.result?.id) {
  console.error(JSON.stringify(initPayload, null, 2));
  process.exit(1);
}

const checkout = initPayload.result.checkout;
if (!checkout?.sessionToken) {
  console.error("Missing checkout session token in initialize response");
  process.exit(1);
}

const { response: confirmResponse, payload: confirmPayload } = await postJsonWithRateLimitRetry(
  `http://localhost:3011/api/v1/checkout/session/${initPayload.result.id}/confirm?token=${encodeURIComponent(checkout.sessionToken)}`,
  { paymentMethod: "MTN_MOMO" }
);

if (!confirmResponse.ok) {
  console.error(JSON.stringify(confirmPayload, null, 2));
  process.exit(1);
}

let finalPayload = confirmPayload;
for (let attempt = 0; attempt < 75 && finalPayload.status === "PROCESSING"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const statusResponse = await fetch(
    `http://localhost:3011/api/v1/checkout/session/${initPayload.result.id}?token=${encodeURIComponent(checkout.sessionToken)}`
  );
  finalPayload = await statusResponse.json();
}

if (finalPayload.status !== "SUCCEEDED") {
  console.error(JSON.stringify(finalPayload, null, 2));
  process.exit(1);
}

console.log(`FLOWPAY_EXTERNAL_TEST_APP_OK ${initPayload.result.id} ${finalPayload.status}`);

async function postJsonWithRateLimitRetry(url, body) {
  let lastPayload;
  let lastResponse;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();

    if (response.status !== 429) {
      return { response, payload };
    }

    lastPayload = payload;
    lastResponse = response;
    const delayMs = 5_000 * attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { response: lastResponse, payload: lastPayload };
}
