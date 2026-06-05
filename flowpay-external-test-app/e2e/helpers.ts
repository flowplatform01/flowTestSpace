import { expect, type Page } from "@playwright/test";

export async function waitForMerchantReady(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Demo Merchant Checkout" })).toBeVisible();
  await expect(page.locator("#flowpayBaseUrl")).not.toHaveText("Loading...", { timeout: 30_000 });
}

export async function completeEmbeddedCheckout(page: Page, options: { authorizeLabel?: RegExp } = {}) {
  const authorizeLabel = options.authorizeLabel ?? /Authorize/i;

  await expect(page.locator("#flowpay-sheet")).toBeVisible({ timeout: 30_000 });
  const iframe = page.frameLocator("#flowpay-iframe");
  await expect(iframe.getByText("Payment Method")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#flowpay-sheet-loader")).toBeHidden({ timeout: 10_000 });
  await iframe.getByRole("button", { name: authorizeLabel }).click();
  await expect(iframe.getByText("Payment Successful")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#flowpay-sheet").getByRole("heading", { name: "Payment Successful" })).toBeVisible({
    timeout: 15_000
  });
}

export async function readJsonPanel(page: Page, selector: string) {
  const panel = page.locator(selector);
  await expect(panel).not.toHaveClass(/loading/, { timeout: 60_000 });
  await expect(panel).toHaveText(/^\s*\{/, { timeout: 60_000 });
  const text = await panel.textContent();
  expect(text).toBeTruthy();
  return JSON.parse(text ?? "{}");
}

export const paymentForm = (page: Page) => page.locator("#paymentForm");

export function uniqueRef(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
