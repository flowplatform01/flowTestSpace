import { expect, test } from "@playwright/test";
import { completeEmbeddedCheckout, paymentForm, readJsonPanel, uniqueRef, waitForMerchantReady } from "./helpers";

test.describe("Recipient confirmation gateway", () => {
  test("merchant submits data, recipient edits payout target, confirms, and transfer succeeds", async ({
    page,
    context
  }) => {
    await waitForMerchantReady(page);

    const recipientId = uniqueRef("e2e-recipient");
    await page.locator('#recipientForm [name="externalRecipientId"]').fill(recipientId);
    await page.locator('#recipientForm [name="displayName"]').fill("E2E Panama School");
    await page.locator('#recipientForm [name="payoutTarget"]').fill("+237677777777");
    await page.locator('#recipientForm button[type="submit"]').click();

    const recipientPayload = await readJsonPanel(page, "#recipientResult");
    expect(recipientPayload.ok).toBe(true);
    expect(recipientPayload.result?.confirmationUrl).toMatch(/\/recipient-confirm\//);
    expect(recipientPayload.result?.status).toBe("PENDING");

    const confirmationUrl = recipientPayload.result.confirmationUrl as string;
    const recipientPage = await context.newPage();
    await recipientPage.goto(confirmationUrl, { waitUntil: "networkidle" });
    await expect(recipientPage.getByRole("heading", { name: "Review Payout Destination" })).toBeVisible({
      timeout: 60_000
    });

    await recipientPage.getByRole("button", { name: "Edit" }).click();
    await recipientPage.getByLabel("Payout target").fill("+237677777778");
    await recipientPage.getByRole("button", { name: "Confirm and activate" }).click();
    await expect(recipientPage.getByRole("heading", { name: "Payout Destination Confirmed" })).toBeVisible({
      timeout: 30_000
    });
    await recipientPage.close();

    const statusResponse = await page.request.get(
      `/api/recipients/status/${encodeURIComponent(recipientPayload.result.savedRecipientId)}`
    );
    expect(statusResponse.ok()).toBeTruthy();
    const statusPayload = await statusResponse.json();
    expect(statusPayload.result?.verificationStatus).toBe("VERIFIED");

    await paymentForm(page).locator('[name="scenarioId"]').selectOption("custom");
    await paymentForm(page).locator('[name="amount"]').fill("18");
    await paymentForm(page).locator('[name="paymentMethod"]').selectOption("CARD_PAYMENT");
    await paymentForm(page).locator('[name="customerPhone"]').fill("+237677777777");
    await paymentForm(page).locator('[name="externalRecipientReference"]').fill(recipientPayload.result.savedRecipientId);
    await paymentForm(page).locator('[name="recipientName"]').fill("E2E Panama School");
    await paymentForm(page).locator('[name="externalReference"]').fill(uniqueRef("e2e-transfer"));
    await page.getByRole("button", { name: "Open Checkout" }).click();

    const paymentPayload = await readJsonPanel(page, "#result");
    expect(paymentPayload.ok).toBe(true);
    expect(paymentPayload.result?.status).toBe("PENDING");

    await completeEmbeddedCheckout(page);
    await expect(page.locator("#result")).toContainText('"status": "SUCCEEDED"', { timeout: 15_000 });
  });
});
