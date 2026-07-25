import type { RuleSystem } from "./types.js";
import { warhammer } from "./warhammer.js";
import { dnd5e } from "./dnd5e.js";

export const RULE_SYSTEMS: Record<string, RuleSystem> = {
  [warhammer.id]: warhammer,
  [dnd5e.id]: dnd5e,
};

export function getRuleSystem(id: string): RuleSystem {
  const rs = RULE_SYSTEMS[id];
  if (!rs) throw new Error(`Unknown rule system: ${id}`);
  return rs;
}

export type { RuleSystem } from "./types.js";
