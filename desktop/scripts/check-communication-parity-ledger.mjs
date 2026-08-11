import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ledgerPath = fileURLToPath(
  new URL(
    "../../docs/luca/communication-parity/COMMUNICATION_PARITY_LEDGER.json",
    import.meta.url,
  ),
);
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));

const expectedBaseline = "81762ad144368bd1b5f5e7f144fdd19a57466676";
const allowed = new Set([
  "preserve",
  "adapt_for_managed_agents",
  "owner_approval_required",
  "owner_only",
  "explicitly_deferred",
  "hidden_product_surface",
]);
const requiredAreas = new Set([
  "messages",
  "reactions",
  "presence",
  "direct_messages",
  "rooms",
  "activation",
  "inbox",
  "profiles",
  "custom_emoji",
  "collaboration_surfaces",
  "product_surfaces",
  "broadcast",
  "security",
]);

const errors = [];
if (ledger.schema_version !== 1) errors.push("schema_version must equal 1");
if (ledger.baseline_commit !== expectedBaseline) {
  errors.push(`baseline_commit must equal ${expectedBaseline}`);
}
if (!Array.isArray(ledger.capabilities) || ledger.capabilities.length === 0) {
  errors.push("capabilities must be a non-empty array");
}

const ids = new Set();
const areas = new Set();
for (const [index, entry] of (ledger.capabilities ?? []).entries()) {
  const label = `capabilities[${index}]`;
  for (const field of [
    "id",
    "area",
    "classification",
    "current_state",
    "rationale",
  ]) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") {
      errors.push(`${label}.${field} must be a non-empty string`);
    }
  }
  if (ids.has(entry.id)) errors.push(`duplicate capability id: ${entry.id}`);
  ids.add(entry.id);
  areas.add(entry.area);
  if (!allowed.has(entry.classification)) {
    errors.push(`${entry.id}: invalid classification ${entry.classification}`);
  }
}

for (const area of requiredAreas) {
  if (!areas.has(area))
    errors.push(`missing required capability area: ${area}`);
}
for (const classification of allowed) {
  if (
    !(ledger.capabilities ?? []).some(
      (entry) => entry.classification === classification,
    )
  ) {
    errors.push(`classification has no entries: ${classification}`);
  }
}

if (errors.length > 0) {
  console.error("Communication parity ledger validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Communication parity ledger valid: ${ledger.capabilities.length} capabilities across ${areas.size} areas.`,
);
