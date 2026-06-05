import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return {};

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce<Record<string, string>>((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return values;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return values;
      values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1).replace(/^"|"$/g, "");
      return values;
    }, {});
}

export async function prepareExternalTestApp() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const apiEnv = loadEnvFile(path.join(repoRoot, "Flowpay/services/api/.env"));
  const testEnv = loadEnvFile(path.join(repoRoot, "flowpay-external-test-app/.env.local"));
  const internalToken = process.env.FLOWPAY_INTERNAL_TOKEN ?? apiEnv.FLOWPAY_INTERNAL_TOKEN;
  const publicKey = process.env.FLOWPAY_PUBLIC_KEY ?? testEnv.FLOWPAY_PUBLIC_KEY;
  const flowpayBaseUrl = process.env.FLOWPAY_BASE_URL ?? testEnv.FLOWPAY_BASE_URL ?? "http://localhost:3011";

  if (!internalToken || !publicKey) {
    console.warn("[e2e setup] Skipping app provisioning prep — missing internal token or public key");
    return;
  }

  const appsResponse = await fetch(`${flowpayBaseUrl}/api/v1/internal/apps`, {
    headers: { "x-flowpay-internal-token": internalToken }
  });

  if (!appsResponse.ok) {
    throw new Error(`Failed to list internal apps: ${appsResponse.status}`);
  }

  const apps = (await appsResponse.json()) as Array<{ id: string; appPublicKey?: string; slug?: string }>;
  const app = apps.find((item) => item.appPublicKey === publicKey) ?? apps.find((item) => item.slug?.includes("newtest"));

  if (!app) {
    throw new Error("Could not find external test app in FlowPay internal app registry");
  }

  const patchResponse = await fetch(`${flowpayBaseUrl}/api/v1/internal/apps/${app.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-flowpay-internal-token": internalToken
    },
    body: JSON.stringify({
      destinationProfileProvisioningEnabled: true,
      destinationProfileAutoVerifyEnabled: false,
      destinationProfileLimit: 50,
      mode1MeteringEnabled: true,
      mode2MeteringEnabled: true
    })
  });

  if (!patchResponse.ok) {
    const body = await patchResponse.text();
    throw new Error(`Failed to prepare external test app (${patchResponse.status}): ${body}`);
  }

  console.log(`[e2e setup] Prepared app ${app.id} for recipient provisioning and credit testing`);
}
