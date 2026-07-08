import { chromium, expect } from "@playwright/test";

const baseUrl = process.env.EXTERNAL_APP_URL ?? "http://127.0.0.1:3025";
const phone = process.env.CAMPAY_SMOKE_PHONE ?? "+237677777777";
const amount = process.env.CAMPAY_SMOKE_AMOUNT ?? "10";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(30_000);

try {
  await page.goto(baseUrl);
  await page.locator("[name=amount]").fill(amount);
  await page.locator("[name=customerPhone]").fill(phone);
  await page.locator("[name=paymentMethod]").selectOption("MTN_MOMO");
  await page.locator("[name=externalReference]").fill(`ui-campay-success-${Date.now()}`);

  await page.getByRole("button", { name: "Open Checkout" }).click();
  await expect(page.locator("#result")).toContainText('"ok": true', { timeout: 60_000 });

  const sheet = page.locator("#flowpay-sheet");
  await expect(sheet).toBeVisible({ timeout: 30_000 });

  const iframe = page.frameLocator("#flowpay-iframe");
  await expect(iframe.getByText("Payment Method")).toBeVisible({ timeout: 120_000 });
  await iframe.getByRole("button", { name: /Authorize/i }).click();

  await expect(sheet.getByRole("heading", { name: "Payment Successful" })).toBeVisible({
    timeout: 240_000
  });
  await expect(page.locator("#result")).toContainText('"checkoutStatus"', { timeout: 10_000 });

  const transactionId = await sheet.locator("code").textContent().catch(() => "unknown");
  console.log(`FLOWPAY_REAL_UI_OK ${transactionId}`);
} finally {
  await browser.close();
}
