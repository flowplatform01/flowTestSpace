import { expect, test } from "@playwright/test";
import { completeEmbeddedCheckout, readJsonPanel, waitForMerchantReady } from "./helpers";

test.describe("Developer credit self-service", () => {
  test("merchant backend purchases credits through hosted checkout", async ({ page }) => {
    await waitForMerchantReady(page);

    await page.getByRole("button", { name: "Refresh Balance" }).click();
    await expect(page.locator("#creditEffectiveBalance")).not.toHaveText("—", { timeout: 15_000 });

    const beforeText = await page.locator("#creditEffectiveBalance").textContent();
    const beforeBalance = Number(beforeText ?? 0);

    await page.locator('#creditPurchaseForm [name="amountXaf"]').fill("1500");
    await page.locator('#creditPurchaseForm [name="creditPaymentMethod"]').selectOption("CARD_PAYMENT");
    await page.locator('#creditPurchaseForm button[type="submit"]').click();

    const purchasePayload = await readJsonPanel(page, "#creditResult");
    expect(purchasePayload.ok).toBe(true);
    expect(purchasePayload.purchaseIntentId).toBeTruthy();
    expect(purchasePayload.result?.checkout?.sessionToken || purchasePayload.result?.checkout?.url).toBeTruthy();

    await completeEmbeddedCheckout(page);
    await expect(page.locator("#creditResult")).toContainText('"status": "SUCCEEDED"', { timeout: 15_000 });

    await page.getByRole("button", { name: "Refresh Balance" }).click();
    await expect
      .poll(async () => Number(await page.locator("#creditEffectiveBalance").textContent()), {
        timeout: 30_000
      })
      .toBeGreaterThan(beforeBalance);

    const purchasesResponse = await page.request.get("/api/credits/purchases");
    expect(purchasesResponse.ok()).toBeTruthy();
    const purchasesPayload = await purchasesResponse.json();
    expect(purchasesPayload.result?.purchases?.some((item: { status: string }) => item.status === "COMPLETED")).toBe(
      true
    );
  });
});
