/**
 * Validate the artifacts produced by the most recent --real wave-1+2 run
 * against all 5 schemas. Used after the night-shift LLM run to confirm the
 * agents' output passes Zod schema validation post-hoc.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { validateDesignSystem } from "../lib/agents/contracts-v2/design-system.schema";
import { validateScreensMap } from "../lib/agents/contracts-v2/screens-map.schema";
import { validateDomainModel } from "../lib/agents/contracts-v2/domain-model.schema";
import { validatePersistence } from "../lib/agents/contracts-v2/persistence.schema";
import { validateSeedsPlan } from "../lib/agents/contracts-v2/seeds-plan.schema";

const root = resolve(__dirname, "..", "out", "test-wave12-workdir", ".atelier");

interface Slot {
  filename: string;
  validate: (a: unknown) => string | null;
}

const slots: Slot[] = [
  { filename: "design-system.json", validate: validateDesignSystem },
  { filename: "screens-map.json", validate: validateScreensMap },
  { filename: "domain-modeler.json", validate: validateDomainModel },
  { filename: "persistence.json", validate: validatePersistence },
  { filename: "seeds-shape.json", validate: validateSeedsPlan },
];

let failed = 0;
for (const slot of slots) {
  const path = `${root}/${slot.filename}`;
  if (!existsSync(path)) {
    console.log(`✗ ${slot.filename}: NOT FOUND`);
    failed++;
    continue;
  }
  const text = readFileSync(path, "utf-8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    console.log(`✗ ${slot.filename}: invalid JSON — ${(err as Error).message}`);
    failed++;
    continue;
  }
  const err = slot.validate(json);
  if (err) {
    console.log(`✗ ${slot.filename}: ${err.slice(0, 250)}`);
    failed++;
  } else {
    console.log(`✓ ${slot.filename}`);
  }
}

console.log(`\nResult: ${slots.length - failed}/${slots.length} valid`);
process.exit(failed > 0 ? 1 : 0);
