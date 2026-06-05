const result = document.querySelector("#result");
const form = document.querySelector("#paymentForm");
const flowpayBaseUrl = document.querySelector("#flowpayBaseUrl");
const publicKeyPreview = document.querySelector("#publicKeyPreview");
const clearBtn = document.querySelector("#clearBtn");
const randomBtn = document.querySelector("#randomBtn");
const copyResultBtn = document.querySelector("#copyResult");
const clearResultBtn = document.querySelector("#clearResult");
const downloadResultBtn = document.querySelector("#downloadResult");
const webhookUrl = document.querySelector("#webhookUrl");
const copyWebhookUrlBtn = document.querySelector("#copyWebhookUrl");
const testWebhookBtn = document.querySelector("#testWebhook");
const clearWebhooksBtn = document.querySelector("#clearWebhooks");
const webhookList = document.querySelector("#webhookList");
const scenarioGrid = document.querySelector("#scenarioGrid");
const securityProbeBtn = document.querySelector("#securityProbeBtn");
const recipientForm = document.querySelector("#recipientForm");
const recipientResult = document.querySelector("#recipientResult");
const recipientConfirmationActions = document.querySelector("#recipientConfirmationActions");
const recipientConfirmationUrl = document.querySelector("#recipientConfirmationUrl");
const copyRecipientConfirmationUrlBtn = document.querySelector("#copyRecipientConfirmationUrl");
const openRecipientConfirmationUrlBtn = document.querySelector("#openRecipientConfirmationUrl");
const creditPurchaseForm = document.querySelector("#creditPurchaseForm");
const creditResult = document.querySelector("#creditResult");
const refreshCreditsBtn = document.querySelector("#refreshCreditsBtn");
const creditEffectiveBalance = document.querySelector("#creditEffectiveBalance");
const creditPosture = document.querySelector("#creditPosture");

// FlowPay Bottom Sheet Elements
const flowpayOverlay = document.getElementById('flowpay-overlay');
const flowpaySheet = document.getElementById('flowpay-sheet');
const closeFlowpaySheetBtn = document.getElementById('close-flowpay-sheet');
const flowpayIframe = document.getElementById('flowpay-iframe');
const flowpaySheetLoader = document.getElementById('flowpay-sheet-loader');
const flowpaySheetTitle = document.getElementById('flowpay-sheet-title');

let webhooks = [];
let scenarios = [];

loadConfig();
loadWebhooks();
void refreshCreditBalance();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!validateForm()) {
    return;
  }

  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Sending...";
  result.textContent = "Calling local app backend...";
  result.classList.add("loading");

  try {
    const data = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/payments/initialize", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        amount: Number(data.amount),
        currency: data.currency,
        scenarioId: data.scenarioId,
        mode: data.mode || null,
        paymentMethod: data.paymentMethod,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        externalReference: data.externalReference || null,
        externalRecipientReference: data.externalRecipientReference || null,
        recipientName: data.recipientName || null,
        orderDescription: data.orderDescription || null,
        idempotencyKey: data.idempotencyKey || null
      })
    });

    const payload = await response.json();
    result.innerHTML = formatResult(JSON.stringify(payload, null, 2));
    result.classList.remove("loading");

    if (response.ok) {
      result.classList.add("success");

      // If payment initialized successfully, trigger the FlowPay Bottom Sheet Checkout
      if (payload.result?.checkout?.url) {
        openFlowpayCheckout(payload.result.checkout.url);
      } else if (payload.result?.id && payload.result?.checkout?.sessionToken) {
        const params = new URLSearchParams({
          token: payload.result.checkout.sessionToken,
          embed: "1"
        });
        openFlowpayCheckout(
          `${checkoutBaseUrl.replace(/\/$/, "")}/checkout/${payload.result.id}?${params.toString()}`
        );
      }
    } else {
      result.classList.add("error");
    }
  } catch (error) {
    result.innerHTML = formatResult(error instanceof Error ? error.message : "Request failed");
    result.classList.remove("loading");
    result.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "Open Checkout";
  }
});

clearBtn.addEventListener("click", () => {
  form.reset();
  setPaymentMethodLocked(false);
  result.classList.remove("success", "error", "loading");
});

randomBtn.addEventListener("click", () => {
  const randomAmount = Math.floor(Math.random() * 10000) + 100;
  const randomPhone = `+237${Math.floor(Math.random() * 900000000) + 100000000}`;
  const randomEmail = `test${Math.floor(Math.random() * 1000)}@example.com`;
  const randomName = `Test User ${Math.floor(Math.random() * 1000)}`;
  const randomRef = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  form.querySelector('[name="amount"]').value = randomAmount;
  form.querySelector('[name="customerPhone"]').value = randomPhone;
  form.querySelector('[name="customerEmail"]').value = randomEmail;
  form.querySelector('[name="customerName"]').value = randomName;
  form.querySelector('[name="externalReference"]').value = randomRef;
  form.querySelector('[name="idempotencyKey"]').value = `key-${Date.now()}`;
});

form.querySelector('[name="scenarioId"]').addEventListener("change", (event) => {
  const scenario = scenarios.find((item) => item.id === event.target.value);
  if (scenario) {
    applyScenario(scenario);
  }
});

securityProbeBtn?.addEventListener("click", async () => {
  securityProbeBtn.disabled = true;
  securityProbeBtn.textContent = "Running probes...";
  result.textContent = "Running malformed request, forged credential, and idempotency probes...";
  result.classList.add("loading");

  try {
    const response = await fetch("/api/security/probes", { method: "POST" });
    const payload = await response.json();
    result.innerHTML = formatResult(JSON.stringify(payload, null, 2));
    result.classList.remove("loading", "error");
    result.classList.add(response.ok ? "success" : "error");
  } catch (error) {
    result.innerHTML = formatResult(error instanceof Error ? error.message : "Security probes failed");
    result.classList.remove("loading", "success");
    result.classList.add("error");
  } finally {
    securityProbeBtn.disabled = false;
    securityProbeBtn.textContent = "Run Security Probes";
  }
});

recipientForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = recipientForm.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Creating...";
  recipientResult.textContent = "Calling merchant backend...";
  recipientResult.classList.add("loading");

  try {
    const data = Object.fromEntries(new FormData(recipientForm));
    const response = await fetch("/api/recipients/create", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(data)
    });
    const payload = await response.json();

    recipientResult.innerHTML = formatResult(JSON.stringify(payload, null, 2));
    recipientResult.classList.remove("loading", "success", "error");
    recipientResult.classList.add(response.ok ? "success" : "error");

    if (response.ok && payload.result?.savedRecipientId) {
      setFormValue("externalRecipientReference", payload.result.savedRecipientId);
      setFormValue("recipientName", data.displayName || payload.result.savedRecipientId);
      setFormValue("orderDescription", `Payment to ${data.displayName || payload.result.savedRecipientId}`);
    }

    if (response.ok && payload.result?.confirmationUrl) {
      showRecipientConfirmationLink(payload.result.confirmationUrl);
    } else {
      hideRecipientConfirmationLink();
    }
  } catch (error) {
    recipientResult.innerHTML = formatResult(error instanceof Error ? error.message : "Recipient setup failed");
    recipientResult.classList.remove("loading", "success");
    recipientResult.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "Create Saved Recipient";
  }
});

copyRecipientConfirmationUrlBtn?.addEventListener("click", () => {
  const url = recipientConfirmationUrl?.textContent;
  if (!url || url === "No confirmation link yet.") return;
  void navigator.clipboard.writeText(url);
  copyRecipientConfirmationUrlBtn.textContent = "Copied!";
  setTimeout(() => {
    copyRecipientConfirmationUrlBtn.textContent = "Copy Link";
  }, 2000);
});

openRecipientConfirmationUrlBtn?.addEventListener("click", () => {
  const url = recipientConfirmationUrl?.textContent;
  if (!url || url === "No confirmation link yet.") return;
  window.open(url, "_blank", "noopener,noreferrer");
});

refreshCreditsBtn?.addEventListener("click", () => {
  void refreshCreditBalance();
});

creditPurchaseForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = creditPurchaseForm.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Starting purchase...";
  creditResult.textContent = "Calling merchant backend for credit purchase...";
  creditResult.classList.add("loading");

  try {
    const data = Object.fromEntries(new FormData(creditPurchaseForm));
    const response = await fetch("/api/credits/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amountXaf: Number(data.amountXaf),
        paymentMethod: data.creditPaymentMethod,
        customerName: data.customerName,
        customerEmail: data.customerEmail
      })
    });
    const payload = await response.json();
    creditResult.innerHTML = formatResult(JSON.stringify(payload, null, 2));
    creditResult.classList.remove("loading");
    creditResult.classList.add(response.ok ? "success" : "error");

    if (response.ok && payload.result?.checkout?.url) {
      openFlowpayCheckout(payload.result.checkout.url);
    } else if (response.ok && payload.result?.id && payload.result?.checkout?.sessionToken) {
      const params = new URLSearchParams({
        token: payload.result.checkout.sessionToken,
        embed: "1"
      });
      openFlowpayCheckout(`${checkoutBaseUrl.replace(/\/$/, "")}/checkout/${payload.result.id}?${params.toString()}`);
    }

    if (response.ok) {
      await refreshCreditBalance();
    }
  } catch (error) {
    creditResult.innerHTML = formatResult(error instanceof Error ? error.message : "Credit purchase failed");
    creditResult.classList.remove("loading", "success");
    creditResult.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "Purchase Credits via Checkout";
  }
});

copyResultBtn.addEventListener("click", () => {
  const text = result.textContent;
  if (text && text !== "No request sent yet.") {
    navigator.clipboard.writeText(text).then(() => {
      copyResultBtn.textContent = "Copied!";
      setTimeout(() => {
        copyResultBtn.textContent = "Copy Result";
      }, 2000);
    });
  }
});

clearResultBtn.addEventListener("click", () => {
  result.innerHTML = "No request sent yet.";
  result.classList.remove("success", "error", "loading");
});

downloadResultBtn.addEventListener("click", () => {
  const text = result.textContent;
  if (text && text !== "No request sent yet.") {
    try {
      const data = JSON.parse(text);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flowpay-result-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Result is not valid JSON');
    }
  }
});

function validateForm() {
  const amount = form.querySelector('[name="amount"]').value;
  const email = form.querySelector('[name="customerEmail"]').value;
  const phone = form.querySelector('[name="customerPhone"]').value;
  const currency = form.querySelector('[name="currency"]').value;

  if (!amount || amount < 1) {
    showError('Amount must be at least 1');
    return false;
  }

  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    showError('Currency must be a 3-letter code');
    return false;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('Please enter a valid email address');
    return false;
  }

  if (!phone || !/^\+?[0-9]{10,15}$/.test(phone)) {
    showError('Please enter a valid phone number');
    return false;
  }

  return true;
}

function applyScenario(scenario) {
  form.querySelector('[name="scenarioId"]').value = scenario.id;
  setFormValue("mode", scenario.mode || "");
  form.querySelector('[name="amount"]').value = scenario.amount || 2500;
  form.querySelector('[name="paymentMethod"]').value = scenario.paymentMethod || "MTN_MOMO";
  setPaymentMethodLocked(Boolean(scenario.lockedPaymentMethod));
  form.querySelector('[name="externalRecipientReference"]').value = scenario.externalRecipientReference || "";
  form.querySelector('[name="recipientName"]').value = scenario.recipientName || "";
  form.querySelector('[name="orderDescription"]').value = scenario.description || "";
  form.querySelector('[name="externalReference"]').value = `${scenario.referencePrefix || "scenario"}-${Date.now()}`;
}

function setFormValue(name, value) {
  const field = form.querySelector(`[name="${name}"]`);
  if (field) {
    field.value = value;
  }
}

function setPaymentMethodLocked(isLocked) {
  const field = form.querySelector('[name="paymentMethod"]');
  if (field) {
    field.disabled = isLocked;
  }
}

copyWebhookUrlBtn.addEventListener("click", () => {
  const url = webhookUrl.textContent;
  navigator.clipboard.writeText(url).then(() => {
    copyWebhookUrlBtn.textContent = "Copied!";
    setTimeout(() => {
      copyWebhookUrlBtn.textContent = "Copy URL";
    }, 2000);
  });
});

testWebhookBtn.addEventListener("click", async () => {
  testWebhookBtn.disabled = true;
  testWebhookBtn.textContent = "Sending...";

  try {
    const testPayload = {
      event: "payment.test",
      data: {
        paymentId: `test_${Date.now()}`,
        status: "success",
        amount: 2500,
        currency: "XAF",
        timestamp: new Date().toISOString()
      }
    };

    const response = await fetch("/webhooks/flowpay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-flowpay-signature": "test-signature"
      },
      body: JSON.stringify(testPayload)
    });

    const result = await response.json();
    addWebhook({
      body: testPayload,
      signature: "test-signature",
      simulated: true
    });

  } catch (error) {
    console.error('Failed to send test webhook:', error);
  } finally {
    testWebhookBtn.disabled = false;
    testWebhookBtn.textContent = "Send Test Webhook";
  }
});

clearWebhooksBtn.addEventListener("click", () => {
  webhooks = [];
  saveWebhooks();
  renderWebhooks();
});

function showError(message) {
  result.innerHTML = formatResult(`Validation Error: ${message}`);
  result.classList.add('error');
  setTimeout(() => {
    result.classList.remove('error');
  }, 3000);
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  scenarios = config.scenarios || [];
  flowpayBaseUrl.textContent = config.flowpayBaseUrl;
  checkoutBaseUrl = config.checkoutBaseUrl || checkoutBaseUrl;
  publicKeyPreview.textContent = `Client ${config.clientId || "not shown"} | Public ${config.publicKeyPreview}`;

  const webhookUrlText = `${window.location.origin}${config.webhookPath}`;
  webhookUrl.textContent = webhookUrlText;
  renderScenarios();
}

function renderScenarios() {
  if (!scenarioGrid) return;

  scenarioGrid.innerHTML = scenarios.map((scenario) => `
    <button type="button" class="scenario-card" data-scenario-id="${escapeHtml(scenario.id)}">
      <span>${escapeHtml(paymentMethodLabel(scenario.paymentMethod) || "Checkout")}</span>
      <strong>${escapeHtml(scenario.name)}</strong>
      <small>${escapeHtml(scenario.description || "")}</small>
    </button>
  `).join("");

  scenarioGrid.querySelectorAll("[data-scenario-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const scenario = scenarios.find((item) => item.id === button.getAttribute("data-scenario-id"));
      if (scenario) {
        applyScenario(scenario);
      }
    });
  });
}

function loadWebhooks() {
  const stored = localStorage.getItem('flowpay-webhooks');
  if (stored) {
    webhooks = JSON.parse(stored);
    renderWebhooks();
  }
}

function saveWebhooks() {
  localStorage.setItem('flowpay-webhooks', JSON.stringify(webhooks));
}

function addWebhook(webhook) {
  webhooks.unshift({
    ...webhook,
    timestamp: new Date().toISOString(),
    id: Date.now()
  });

  if (webhooks.length > 10) {
    webhooks = webhooks.slice(0, 10);
  }

  saveWebhooks();
  renderWebhooks();
}

function renderWebhooks() {
  if (webhooks.length === 0) {
    webhookList.innerHTML = '<p class="no-webhooks">No webhooks received yet.</p>';
    return;
  }

  webhookList.innerHTML = webhooks.map(webhook => `
    <div class="webhook-item">
      <div class="webhook-header">
        <span class="webhook-timestamp">${new Date(webhook.timestamp).toLocaleString()}</span>
        ${webhook.signature ? `<span class="webhook-signature">Signed</span>` : '<span class="webhook-signature">No Signature</span>'}
      </div>
      <div class="webhook-content">${formatResult(JSON.stringify(webhook.body, null, 2))}</div>
    </div>
  `).join('');
}

// FlowPay Checkout Bottom Sheet Logic
let checkoutBaseUrl = "http://localhost:3010";
let checkoutLoadTimeout = null;
let checkoutCompletionTimeout = null;

function showRecipientConfirmationLink(url) {
  if (!recipientConfirmationActions || !recipientConfirmationUrl) return;
  recipientConfirmationUrl.textContent = url;
  recipientConfirmationActions.classList.remove("hidden");
}

function hideRecipientConfirmationLink() {
  recipientConfirmationActions?.classList.add("hidden");
}

async function refreshCreditBalance() {
  if (!creditEffectiveBalance || !creditPosture) return;

  try {
    const response = await fetch("/api/credits/balance");
    const payload = await response.json();

    if (response.ok && payload.result) {
      creditEffectiveBalance.textContent = String(payload.result.effectiveBalance ?? "—");
      creditPosture.textContent = String(payload.result.posture ?? "—");
    } else {
      creditEffectiveBalance.textContent = "Unavailable";
      creditPosture.textContent = "—";
    }
  } catch {
    creditEffectiveBalance.textContent = "Unavailable";
    creditPosture.textContent = "—";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function paymentMethodLabel(paymentMethod) {
  return {
    MTN_MOMO: "MTN Mobile Money",
    ORANGE_MONEY: "Orange Money",
    CARD_PAYMENT: "Card",
    BANK_TRANSFER: "Bank Transfer"
  }[paymentMethod] ?? String(paymentMethod || "");
}

function ensureEmbedCheckoutUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set("embed", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

function showCheckoutLoader() {
  flowpaySheetLoader?.classList.remove("hidden");
}

function hideCheckoutLoader() {
  flowpaySheetLoader?.classList.add("hidden");
}

function getCheckoutStatusNode() {
  const content = document.querySelector(".flowpay-sheet-content");
  if (!content) return null;

  let statusNode = document.getElementById("flowpay-sheet-status");
  if (!statusNode) {
    statusNode = document.createElement("div");
    statusNode.id = "flowpay-sheet-status";
    content.appendChild(statusNode);
  }

  return statusNode;
}

function resetCheckoutChrome() {
  flowpaySheetTitle.textContent = "Complete Payment";
  document.getElementById("flowpay-sheet-error")?.remove();
  document.getElementById("flowpay-sheet-status")?.remove();
  flowpayIframe.classList.remove("flowpay-iframe-dimmed");
}

function showCheckoutLoadError(message) {
  hideCheckoutLoader();
  const content = document.querySelector(".flowpay-sheet-content");
  if (!content) return;

  let errorNode = document.getElementById("flowpay-sheet-error");
  if (!errorNode) {
    errorNode = document.createElement("div");
    errorNode.id = "flowpay-sheet-error";
    errorNode.className = "flowpay-sheet-error";
    content.appendChild(errorNode);
  }

  errorNode.className = "flowpay-sheet-error visible";
  errorNode.innerHTML = `<p>${message}</p><button type="button">Close</button>`;
  errorNode.querySelector("button")?.addEventListener("click", closeFlowpayCheckout, { once: true });
}

function updateResultWithCheckoutStatus(statusPayload) {
  const rawText = result.textContent;
  if (!rawText || rawText === "No request sent yet.") return;

  try {
    const parsed = JSON.parse(rawText);
    parsed.checkoutStatus = {
      status: statusPayload.status,
      transactionId: statusPayload.transactionId,
      message: statusPayload.message ?? null,
      completedAt: new Date().toISOString()
    };
    result.innerHTML = formatResult(JSON.stringify(parsed, null, 2));
    result.classList.remove("loading", "error", "success");
    result.classList.add(statusPayload.status === "SUCCEEDED" || statusPayload.status === "UNDER_REVIEW" ? "success" : "error");
  } catch {
    // If the result panel contains a non-JSON error, keep it untouched.
  }
}

function showCheckoutTerminalState({ status, transactionId, message }) {
  hideCheckoutLoader();

  if (checkoutCompletionTimeout) {
    clearTimeout(checkoutCompletionTimeout);
    checkoutCompletionTimeout = null;
  }

  const isSuccess = status === "SUCCEEDED";
  const isReview = status === "UNDER_REVIEW";
  flowpaySheetTitle.textContent = isSuccess ? "Payment Confirmed" : isReview ? "Payment Under Review" : "Payment Not Completed";
  flowpayIframe.classList.add("flowpay-iframe-dimmed");

  const statusNode = getCheckoutStatusNode();
  if (!statusNode) return;

  statusNode.className = `flowpay-sheet-status visible ${isSuccess ? "success" : isReview ? "warning" : "error"}`;
  statusNode.innerHTML = `
    <div class="flowpay-sheet-status-icon" aria-hidden="true">${isSuccess ? "✓" : "!"}</div>
    <h3>${isSuccess ? "Payment Successful" : isReview ? "Payment Under Review" : "Payment Failed"}</h3>
    <p>${escapeHtml(message || (isSuccess ? "FlowPay confirmed this transaction." : isReview ? "FlowPay is reviewing this transaction." : "This transaction could not be completed."))}</p>
    ${transactionId ? `<code>${escapeHtml(transactionId)}</code>` : ""}
    <button type="button">${isSuccess ? "Done" : "Close"}</button>
  `;
  statusNode.querySelector("button")?.addEventListener("click", closeFlowpayCheckout, { once: true });

  updateResultWithCheckoutStatus({ status, transactionId, message });
}

function openFlowpayCheckout(checkoutUrl) {
  const embeddedUrl = ensureEmbedCheckoutUrl(checkoutUrl);

  flowpayOverlay.classList.remove("hidden");
  flowpaySheet.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  resetCheckoutChrome();

  showCheckoutLoader();
  flowpayIframe.removeAttribute("style");

  if (checkoutLoadTimeout) {
    clearTimeout(checkoutLoadTimeout);
  }

  checkoutLoadTimeout = setTimeout(() => {
    showCheckoutLoadError("Checkout is taking too long. Ensure FlowPay checkout is running on port 3010.");
  }, 90_000);

  checkoutCompletionTimeout = setTimeout(() => {
    const statusNode = getCheckoutStatusNode();
    if (!statusNode || statusNode.classList.contains("visible")) return;

    statusNode.className = "flowpay-sheet-status visible pending";
    statusNode.innerHTML = `
      <div class="flowpay-sheet-status-icon" aria-hidden="true">...</div>
      <h3>Still Waiting</h3>
      <p>The payment is still being confirmed. Keep the checkout open or check the order from the merchant dashboard.</p>
      <button type="button">Keep Open</button>
    `;
    statusNode.querySelector("button")?.addEventListener("click", () => statusNode.remove(), { once: true });
  }, 180_000);

  flowpayIframe.src = embeddedUrl;
}

function closeFlowpayCheckout() {
  if (checkoutLoadTimeout) {
    clearTimeout(checkoutLoadTimeout);
    checkoutLoadTimeout = null;
  }
  if (checkoutCompletionTimeout) {
    clearTimeout(checkoutCompletionTimeout);
    checkoutCompletionTimeout = null;
  }

  flowpayOverlay.classList.add("hidden");
  flowpaySheet.classList.add("hidden");
  document.body.style.overflow = "";
  hideCheckoutLoader();

  setTimeout(() => {
    flowpayIframe.src = "about:blank";
  }, 400);
}

window.addEventListener("message", (event) => {
  if (!event?.data || typeof event.data !== "object") return;
  if (event.data.type === "flowpay:checkout-ready") {
    if (checkoutLoadTimeout) {
      clearTimeout(checkoutLoadTimeout);
      checkoutLoadTimeout = null;
    }
    hideCheckoutLoader();
    document.getElementById("flowpay-sheet-error")?.classList.remove("visible");
  }

  if (event.data.type === "flowpay:checkout-status") {
    if (event.data.status === "PROCESSING") {
      hideCheckoutLoader();
      const statusNode = getCheckoutStatusNode();
      if (statusNode && !statusNode.classList.contains("visible")) {
        statusNode.className = "flowpay-sheet-status compact pending";
        statusNode.innerHTML = "<p>Waiting for payment confirmation...</p>";
      }
    }

    if (["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED", "UNDER_REVIEW"].includes(event.data.status)) {
      showCheckoutTerminalState(event.data);
    }
  }

  if (event.data.type === "flowpay:checkout-completed") {
    showCheckoutTerminalState({ ...event.data, status: "SUCCEEDED" });
  }

  if (event.data.type === "flowpay:checkout-failed") {
    showCheckoutTerminalState(event.data);
  }
});

closeFlowpaySheetBtn.addEventListener('click', closeFlowpayCheckout);
flowpayOverlay.addEventListener('click', closeFlowpayCheckout);
