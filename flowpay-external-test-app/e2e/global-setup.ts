import { chromium, type FullConfig } from "@playwright/test";
import { prepareExternalTestApp } from "./prepare-test-app";

async function waitForOk(url: string, label: string) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[e2e setup] ${label} ready: ${url}`);
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`${label} not ready at ${url}`);
}

export default async function globalSetup(_config: FullConfig) {
  await waitForOk("http://127.0.0.1:3025/api/config", "External test app");
  await waitForOk("http://localhost:3011/api/v1/health", "FlowPay API");
  await waitForOk("http://localhost:3010/", "FlowPay checkout");
  await prepareExternalTestApp();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://localhost:3010/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await browser.close();
  console.log("[e2e setup] Checkout bundle warmed");
}
