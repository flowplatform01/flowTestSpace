import { expect, test } from "@playwright/test";
import { completeEmbeddedCheckout, paymentForm, waitForMerchantReady } from "./helpers";

test.describe("FlowPay external integration", () => {
  test("send test payment completes hosted checkout successfully", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await waitForMerchantReady(page);

    const externalRef = `e2e-success-${Date.now()}`;
    await paymentForm(page).locator('[name="externalReference"]').fill(externalRef);
    await paymentForm(page).locator('[name="amount"]').fill("3200");
    await paymentForm(page).locator('[name="paymentMethod"]').selectOption("CARD_PAYMENT");

    await page.getByRole("button", { name: "Open Checkout" }).click();

    const result = page.locator("#result");
    await expect(result).toContainText('"ok": true', { timeout: 45_000 });
    await expect(result).toContainText('"status": "PENDING"', { timeout: 45_000 });
    await expect(result).toContainText("checkout", { timeout: 45_000 });

    await completeEmbeddedCheckout(page);
    await expect(result).toContainText('"checkoutStatus"', { timeout: 10_000 });
    await expect(result).toContainText('"status": "SUCCEEDED"', { timeout: 10_000 });

    const criticalConsoleErrors = consoleErrors.filter(
      (line) =>
        !line.includes("favicon") &&
        !line.includes("404") &&
        !line.includes("CORS policy") &&
        !line.includes("net::ERR_FAILED")
    );
    expect(criticalConsoleErrors).toEqual([]);
  });

  test("payment with fail reference shows failure in checkout", async ({ page }) => {
    await waitForMerchantReady(page);

    await paymentForm(page).locator('[name="scenarioId"]').selectOption("provider-failure");
    await paymentForm(page).locator('[name="externalReference"]').fill(`e2e-fail-${Date.now()}`);
    await paymentForm(page).locator('[name="paymentMethod"]').selectOption("CARD_PAYMENT");
    await page.getByRole("button", { name: "Open Checkout" }).click();

    await expect(page.locator("#result")).toContainText('"ok": true', { timeout: 45_000 });
    await expect(page.locator("#flowpay-sheet")).toBeVisible({ timeout: 15_000 });

    const iframe = page.frameLocator("#flowpay-iframe");
    await expect(iframe.getByText("Payment Method")).toBeVisible({ timeout: 60_000 });
    await iframe.getByRole("button", { name: /Authorize/i }).click();

    await expect(iframe.getByRole("heading", { name: "Payment Failed" })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("#flowpay-sheet").getByRole("heading", { name: "Payment Failed" })).toBeVisible({
      timeout: 10_000
    });
  });
});
