import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const env = loadEnv(join(rootDir, ".env.local"));
const port = Number(env.TEST_APP_PORT ?? 3025);
const flowpayBaseUrl = env.FLOWPAY_BASE_URL ?? "http://localhost:3011";
const checkoutBaseUrl = env.FLOWPAY_CHECKOUT_URL ?? "http://localhost:3010";

const requiredEnv = ["FLOWPAY_PUBLIC_KEY", "FLOWPAY_SECRET_KEY", "FLOWPAY_WEBHOOK_SECRET"];
for (const key of requiredEnv) {
  if (!env[key]) {
    throw new Error(`${key} is required in .env.local`);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/") {
      return sendFile(response, "public/index.html");
    }

    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      return sendFile(response, url.pathname.slice(1));
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, 200, {
        flowpayBaseUrl,
        checkoutBaseUrl,
        clientId: env.FLOWPAY_CLIENT_ID,
        publicKeyPreview: maskKey(env.FLOWPAY_PUBLIC_KEY),
        webhookPath: "/webhooks/flowpay",
        scenarios: publicScenarioCatalog()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/scenarios") {
      return sendJson(response, 200, publicScenarioCatalog());
    }

    if (request.method === "POST" && url.pathname === "/api/payments/initialize") {
      const body = await readJson(request);
      const scenario = internalScenarioCatalog().find((item) => item.id === body.scenarioId);
      const mode = body.mode || scenario?.mode || (body.externalRecipientReference ? "MODE_2" : "MODE_1");
      const paymentMethod = resolveScenarioPaymentMethod(scenario, body.paymentMethod);
      const checkoutDescription = normalizeOptionalText(
        body.orderDescription || body.checkoutDescription || body.transferPurpose || body.transactionNote || scenario?.description,
        120
      );
      const recipientName = normalizeOptionalText(body.recipientName || scenario?.recipientName, 80);
      const recipientAccount = normalizeOptionalText(body.recipientAccount || scenario?.recipientAccount, 40);
      const payload = {
        externalReference:
          body.externalReference ||
          `${scenario?.referencePrefix || (mode === "MODE_2" ? "recipient-transfer" : "merchant-order")}-${Date.now()}`,
        amount: Number(body.amount || scenario?.amount || 1000),
        currency: body.currency || "XAF",
        paymentMethod,
        deferCapture: body.deferCapture !== undefined ? Boolean(body.deferCapture) : true,
        customerName: body.customerName || "External Test Customer",
        customerEmail: body.customerEmail || "customer@example.com",
        customerPhone: body.customerPhone || "+237600000000",
        external_recipient_reference:
          mode === "MODE_2" ? body.externalRecipientReference || scenario?.externalRecipientReference : undefined,
        metadata: {
          checkoutDescription,
          recipientName,
          recipientAccount
        }
      };
      stripUndefined(payload);
      stripUndefined(payload.metadata);

      const idempotencyKey = body.idempotencyKey || randomUUID();
      const { flowpayResponse, result, attempts } = await callFlowPayWithRetry({
        path: "/api/v1/payments/initialize",
        idempotencyKey,
        payload
      });

      return sendJson(response, flowpayResponse.status, {
        ok: flowpayResponse.ok,
        status: flowpayResponse.status,
        attempts,
        request: merchantRequestSummary(payload, scenario),
        result: flowpayResponse.ok ? merchantFlowPayResult(result) : merchantErrorResult(result)
      });
    }

    if (request.method === "POST" && url.pathname === "/api/security/probes") {
      const timestamp = Date.now();
      const malformedResponse = await fetch(`${flowpayBaseUrl}/api/v1/payments/initialize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `probe-malformed-${timestamp}`
        },
        body: JSON.stringify({
          externalReference: `probe-malformed-${timestamp}`,
          amount: -1,
          currency: "XAF",
          paymentMethod: "MTN_MOMO"
        })
      });
      const malformedBody = await malformedResponse.json().catch(() => ({}));
      const forgedCredentialResponse = await fetch(`${flowpayBaseUrl}/api/v1/payments/initialize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `probe-forged-${timestamp}`,
          "x-flowpay-public-key": env.FLOWPAY_PUBLIC_KEY,
          "x-flowpay-secret-key": "forged-secret"
        },
        body: JSON.stringify({
          externalReference: `probe-forged-${timestamp}`,
          amount: 5,
          currency: "XAF",
          paymentMethod: "MTN_MOMO"
        })
      });
      const forgedCredentialBody = await forgedCredentialResponse.json().catch(() => ({}));
      const idempotencyKey = `probe-idempotency-${timestamp}`;
      const idempotencyPayload = {
        externalReference: `probe-idempotency-${timestamp}`,
        amount: 5,
        currency: "XAF",
        paymentMethod: "MTN_MOMO",
        deferCapture: true,
        customerName: "Probe Customer",
        customerEmail: "probe@example.com",
        customerPhone: "+237677777777"
      };
      const first = await callFlowPayWithRetry({
        path: "/api/v1/payments/initialize",
        idempotencyKey,
        payload: idempotencyPayload
      });
      const second = await callFlowPayWithRetry({
        path: "/api/v1/payments/initialize",
        idempotencyKey,
        payload: idempotencyPayload
      });

      return sendJson(response, 200, {
        malformedRequest: {
          status: malformedResponse.status,
          ok: malformedResponse.ok,
          body: malformedBody
        },
        forgedCredentials: {
          status: forgedCredentialResponse.status,
          ok: forgedCredentialResponse.ok,
          body: forgedCredentialBody
        },
        idempotency: {
          firstStatus: first.flowpayResponse.status,
          secondStatus: second.flowpayResponse.status,
          sameTransaction: Boolean(first.result?.id && first.result.id === second.result?.id),
          firstTransactionId: first.result?.id,
          secondTransactionId: second.result?.id
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/credits/balance") {
      const flowpayResponse = await fetch(`${flowpayBaseUrl}/api/v1/credits/balance`, {
        headers: flowpayAuthHeaders()
      });
      const result = await flowpayResponse.json().catch(() => ({
        message: "FlowPay returned a non-JSON response"
      }));

      return sendJson(response, flowpayResponse.status, {
        ok: flowpayResponse.ok,
        status: flowpayResponse.status,
        result: flowpayResponse.ok ? merchantCreditBalanceResult(result) : merchantErrorResult(result)
      });
    }

    if (request.method === "GET" && url.pathname === "/api/credits/purchases") {
      const flowpayResponse = await fetch(`${flowpayBaseUrl}/api/v1/credits/purchases`, {
        headers: flowpayAuthHeaders()
      });
      const result = await flowpayResponse.json().catch(() => ({
        message: "FlowPay returned a non-JSON response"
      }));

      return sendJson(response, flowpayResponse.status, {
        ok: flowpayResponse.ok,
        status: flowpayResponse.status,
        result: flowpayResponse.ok ? result : merchantErrorResult(result)
      });
    }

    if (request.method === "POST" && url.pathname === "/api/credits/purchase") {
      const body = await readJson(request);
      const amountXaf = Number(body.amountXaf || body.amount || 0);

      if (!Number.isFinite(amountXaf) || amountXaf < 100) {
        return sendJson(response, 400, {
          ok: false,
          message: "Credit purchase amount must be at least 100 XAF"
        });
      }

      const purchaseResponse = await fetch(`${flowpayBaseUrl}/api/v1/credits/purchase/initiate`, {
        method: "POST",
        headers: {
          ...flowpayAuthHeaders(),
          "content-type": "application/json"
        },
        body: JSON.stringify({
          amountXaf,
          customerPhone: body.customerPhone || "+237677777777",
          customerEmail: body.customerEmail || "billing@merchant.example.com",
          customerName: body.customerName || "Merchant Billing Contact"
        })
      });
      const purchase = await purchaseResponse.json().catch(() => ({
        message: "FlowPay returned a non-JSON response"
      }));

      if (!purchaseResponse.ok) {
        return sendJson(response, purchaseResponse.status, {
          ok: false,
          status: purchaseResponse.status,
          result: merchantErrorResult(purchase)
        });
      }

      const instructions = purchase.instructions ?? {};
      const initializePayload = {
        externalReference: instructions.externalReference || purchase.externalReference,
        amount: instructions.amount || amountXaf,
        currency: instructions.currency || "XAF",
        paymentMethod: body.paymentMethod || "CARD_PAYMENT",
        deferCapture: true,
        customerName: instructions.customerName || body.customerName || "Merchant Billing Contact",
        customerEmail: instructions.customerEmail || body.customerEmail || "billing@merchant.example.com",
        customerPhone: instructions.customerPhone || body.customerPhone || "+237677777777",
        metadata: instructions.metadata
      };

      const { flowpayResponse, result, attempts } = await callFlowPayWithRetry({
        path: "/api/v1/payments/initialize",
        idempotencyKey: randomUUID(),
        payload: initializePayload
      });

      return sendJson(response, flowpayResponse.status, {
        ok: flowpayResponse.ok,
        status: flowpayResponse.status,
        attempts,
        purchaseIntentId: purchase.purchaseIntentId,
        request: {
          amountXaf,
          paymentMethod: paymentMethodLabel(initializePayload.paymentMethod),
          customerName: initializePayload.customerName
        },
        result: flowpayResponse.ok ? merchantFlowPayResult(result) : merchantErrorResult(result)
      });
    }

    if (request.method === "POST" && url.pathname === "/api/recipients/create") {
      const body = await readJson(request);
      const payoutMethod = body.payoutMethod || body.preferredMethod || "MTN_MOMO";
      const payload = {
        externalRecipientId: normalizeRecipientReference(body.externalRecipientId),
        providerType: resolveProviderForMerchantRail(payoutMethod),
        payoutTarget: normalizeOptionalText(body.payoutTarget, 80),
        settlementStrategy: body.settlementStrategy || "TWO_STEP_MIRROR",
        regionalCurrency: (body.regionalCurrency || "XAF").toUpperCase(),
        supportedRails: ["MOBILE_MONEY"],
        providerMetadata: {
          displayName: normalizeOptionalText(body.displayName, 80)
        },
        routingPreferences: {
          preferredMethod: payoutMethod
        }
      };
      stripUndefined(payload);
      stripUndefined(payload.providerMetadata);
      stripUndefined(payload.routingPreferences);

      if (!payload.externalRecipientId || !payload.payoutTarget) {
        return sendJson(response, 400, {
          ok: false,
          message: "Recipient reference and payout target are required"
        });
      }

      const flowpayResponse = await fetch(`${flowpayBaseUrl}/api/v1/destination-profiles`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flowpay-public-key": env.FLOWPAY_PUBLIC_KEY,
          "x-flowpay-secret-key": env.FLOWPAY_SECRET_KEY
        },
        body: JSON.stringify(payload)
      });
      const result = await flowpayResponse.json().catch(() => ({
        message: "FlowPay returned a non-JSON response"
      }));

      return sendJson(response, flowpayResponse.status, {
        ok: flowpayResponse.ok,
        status: flowpayResponse.status,
        request: {
          savedRecipientId: payload.externalRecipientId,
          displayName: payload.providerMetadata?.displayName,
          payoutMethod: paymentMethodLabel(payoutMethod),
          payoutTarget: maskPayoutTarget(payload.payoutTarget),
          settlementStrategy: settlementStrategyLabel(payload.settlementStrategy),
          regionalCurrency: payload.regionalCurrency
        },
        result: flowpayResponse.ok ? merchantRecipientResult(result, payoutMethod) : merchantErrorResult(result)
      });
    }

    if (request.method === "POST" && url.pathname === "/webhooks/flowpay") {
      const body = await readJson(request);
      const signature = request.headers["x-flowpay-signature"] ?? null;

      return sendJson(response, 200, {
        received: true,
        signaturePresent: Boolean(signature),
        webhookSecretConfigured: Boolean(env.FLOWPAY_WEBHOOK_SECRET),
        body
      });
    }

    return sendJson(response, 404, { message: "Not found" });
  } catch (error) {
    console.error("Test App Error:", error);
    return sendJson(response, 500, {
      message: error instanceof Error ? error.message : "Unexpected test app error"
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`FlowPay external test app running on http://127.0.0.1:${port}`);
});

function loadEnv(path) {
  const values = {};
  const content = readFileSync(path, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }

  return values;
}

function sendFile(response, relativePath) {
  const path = join(rootDir, relativePath.startsWith("assets/") ? "public/" : "", relativePath);
  const content = readFileSync(path);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  }[extname(path)] ?? "application/octet-stream";

  response.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store, max-age=0"
  });
  response.end(content);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function maskKey(value = "") {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function stripUndefined(record) {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
}

function normalizeOptionalText(value, maxLength) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function normalizeRecipientReference(value) {
  return normalizeOptionalText(value, 80)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function maskPayoutTarget(value = "") {
  if (value.length <= 6) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function resolveProviderForMerchantRail(paymentMethod) {
  const normalized = String(paymentMethod || "").toUpperCase();
  if (normalized === "ORANGE_MONEY") return "MAVIANCE";
  if (normalized === "BANK_TRANSFER") return "CINETPAY";
  return "CAMPAY";
}

function paymentMethodLabel(paymentMethod) {
  return {
    MTN_MOMO: "MTN Mobile Money",
    ORANGE_MONEY: "Orange Money",
    CARD_PAYMENT: "Card",
    BANK_TRANSFER: "Bank Transfer"
  }[paymentMethod] ?? String(paymentMethod || "Payment method");
}

function settlementStrategyLabel(strategy) {
  return strategy === "NATIVE_SPLIT" ? "Direct split settlement" : "Collect then settle";
}

function merchantRequestSummary(payload, scenario) {
  return {
    orderReference: payload.externalReference,
    checkoutType: scenario?.name || "Custom merchant payment",
    amount: payload.amount,
    currency: payload.currency,
    paymentMethod: paymentMethodLabel(payload.paymentMethod),
    customerName: payload.customerName,
    customerEmail: payload.customerEmail,
    customerPhone: payload.customerPhone,
    savedRecipientId: payload.external_recipient_reference,
    recipientName: payload.metadata?.recipientName,
    checkoutDescription: payload.metadata?.checkoutDescription
  };
}

function merchantRecipientResult(result, payoutMethod) {
  if (!result || typeof result !== "object") return result;
  return {
    id: result.id,
    savedRecipientId: result.externalRecipientId,
    payoutMethod: paymentMethodLabel(payoutMethod),
    settlementStrategy: settlementStrategyLabel(result.settlementStrategy),
    status: result.verificationStatus,
    currency: result.regionalCurrency,
    confirmationUrl: result.confirmationUrl ?? null,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt
  };
}

function merchantFlowPayResult(result) {
  if (!result || typeof result !== "object") return result;
  return {
    id: result.id,
    externalReference: result.externalReference,
    amount: result.amount,
    grossAmount: result.grossAmount,
    platformFeeAmount: result.platformFeeAmount,
    gatewayFeeAmount: result.gatewayFeeAmount,
    currency: result.currency,
    status: result.status,
    checkout: result.checkout
  };
}

function merchantCreditBalanceResult(result) {
  if (!result || typeof result !== "object") return result;
  return {
    effectiveBalance: result.effectiveBalance,
    posture: result.posture,
    depleted: result.depleted,
    balances: result.balances,
    meteringEnabled: result.meteringEnabled
  };
}

function flowpayAuthHeaders() {
  return {
    "x-flowpay-public-key": env.FLOWPAY_PUBLIC_KEY,
    "x-flowpay-secret-key": env.FLOWPAY_SECRET_KEY
  };
}

function merchantErrorResult(result) {
  if (!result || typeof result !== "object") return result;
  const rawMessage = result.message || result.error || "Payment request failed";
  return {
    message: publicPaymentErrorMessage(rawMessage),
    code: result.code,
    statusCode: result.statusCode
  };
}

function publicPaymentErrorMessage(message) {
  const normalized = String(message);
  if (
    normalized.toLowerCase().includes("destination profile") ||
    normalized.toLowerCase().includes("external_recipient")
  ) {
    return "Saved recipient was not found or is not ready for payouts. Choose a saved recipient from the merchant dashboard, or ask an operator to verify it.";
  }

  if (normalized.toLowerCase().includes("recipient provisioning is not enabled")) {
    return "Saved-recipient setup is not enabled for this merchant app. Ask a FlowPay operator to enable it before creating recipients.";
  }

  if (normalized.toLowerCase().includes("recipient profile limit")) {
    return "This merchant app has reached its saved-recipient setup limit. Ask a FlowPay operator to review the recipient limit.";
  }

  if (normalized.toLowerCase().includes("orchestration")) {
    return "This saved-recipient payment is not ready yet. Please check the recipient setup from the merchant dashboard.";
  }

  return normalized;
}

function publicScenarioCatalog() {
  return internalScenarioCatalog().map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    paymentMethod: scenario.paymentMethod,
    lockedPaymentMethod: Boolean(scenario.lockedPaymentMethod),
    amount: scenario.amount,
    recipientName: scenario.recipientName,
    recipientAccount: scenario.recipientAccount,
    referencePrefix: scenario.referencePrefix,
    description: scenario.description
  }));
}

function internalScenarioCatalog() {
  return [
    {
      id: "merchant-collection",
      name: "Online Store Order",
      mode: "MODE_1",
      paymentMethod: "MTN_MOMO",
      amount: 2500,
      referencePrefix: "order",
      description: "Online store checkout"
    },
    {
      id: "saas-subscription",
      name: "Subscription Invoice",
      mode: "MODE_1",
      paymentMethod: "CARD_PAYMENT",
      amount: 9900,
      referencePrefix: "invoice",
      description: "Monthly subscription invoice"
    },
    {
      id: "tenant-transfer",
      name: "Saved Recipient Transfer",
      mode: "MODE_2",
      paymentMethod: "ORANGE_MONEY",
      amount: 1500,
      externalRecipientReference: "panama-mode2-recipient",
      recipientName: "Panama Stores Wallet",
      recipientAccount: "+237677777777",
      referencePrefix: "transfer",
      description: "Wallet transfer to saved recipient"
    },
    {
      id: "provider-failure",
      name: "Declined Payment Test",
      mode: "MODE_1",
      paymentMethod: "CARD_PAYMENT",
      amount: 3200,
      referencePrefix: "scenario-fail",
      description: "Declined card test",
      lockedPaymentMethod: true
    },
    {
      id: "invalid-recipient",
      name: "Unknown Recipient Test",
      mode: "MODE_2",
      paymentMethod: "ORANGE_MONEY",
      amount: 1000,
      externalRecipientReference: "missing-recipient-reference",
      recipientName: "Unknown Saved Recipient",
      recipientAccount: "unverified",
      referencePrefix: "invalid-recipient",
      description: "Invalid saved-recipient check"
    }
  ];
}

function resolveScenarioPaymentMethod(scenario, requestedPaymentMethod) {
  if (scenario?.lockedPaymentMethod) {
    return scenario.paymentMethod;
  }

  return requestedPaymentMethod || scenario?.paymentMethod || "MTN_MOMO";
}

async function callFlowPayWithRetry(input) {
  let lastResponse;
  let lastResult;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      lastResponse = await fetch(`${flowpayBaseUrl}${input.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          "x-flowpay-public-key": env.FLOWPAY_PUBLIC_KEY,
          "x-flowpay-secret-key": env.FLOWPAY_SECRET_KEY
        },
        body: JSON.stringify(input.payload)
      });

      lastResult = await lastResponse.json().catch(() => ({
        message: "FlowPay returned a non-JSON response"
      }));

      if (!isRetryableFlowPayStatus(lastResponse.status)) {
        return { flowpayResponse: lastResponse, result: lastResult, attempts: attempt };
      }
    } catch (error) {
      lastResponse = {
        ok: false,
        status: 503
      };
      lastResult = {
        message: error instanceof Error ? error.message : "FlowPay request failed"
      };
    }

    if (attempt < 4) {
      await wait(backoffDelay(attempt));
    }
  }

  return { flowpayResponse: lastResponse, result: lastResult, attempts: 4 };
}

function isRetryableFlowPayStatus(status) {
  return [429, 500, 502, 503, 504].includes(status);
}

function backoffDelay(attempt) {
  const baseDelay = 500 * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(baseDelay + jitter, 3_000);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
