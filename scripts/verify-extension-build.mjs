import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distDir = join(process.cwd(), "dist");
const manifestPath = join(distDir, "manifest.json");

const requiredPermissions = ["sidePanel", "storage", "activeTab", "scripting", "tabs"];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(existsSync(manifestPath), "dist/manifest.json was not found");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sidePanelPath = manifest.side_panel?.default_path;
const serviceWorkerPath = manifest.background?.service_worker;

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(typeof sidePanelPath === "string", "side_panel.default_path is missing");
assert(typeof serviceWorkerPath === "string", "background.service_worker is missing");
assert(existsSync(join(distDir, sidePanelPath)), `side panel file is missing: ${sidePanelPath}`);
assert(
  existsSync(join(distDir, serviceWorkerPath)),
  `service worker file is missing: ${serviceWorkerPath}`
);

for (const permission of requiredPermissions) {
  assert(
    manifest.permissions?.includes(permission),
    `manifest is missing permission: ${permission}`
  );
}

assert(
  manifest.optional_host_permissions?.includes("http://*/*") &&
    manifest.optional_host_permissions?.includes("https://*/*"),
  "manifest is missing expected optional host permissions"
);

console.log("Extension build smoke passed");
console.log(`- manifest: ${manifestPath}`);
console.log(`- side panel: dist/${sidePanelPath}`);
console.log(`- service worker: dist/${serviceWorkerPath}`);
