/**
 * The UI's only window on the ground: evidence, interpretations and the field party's errand.
 * Never imports truth.
 */
import type { WorldState } from "../core/engine";
import type { KnowledgeState } from "./types";

export * from "./types";

export interface KnowledgeView {
  evidence: KnowledgeState["evidence"];
  interp: KnowledgeState["interp"];
  task: KnowledgeState["task"];
}

export function knowledgeOf(world: Readonly<WorldState>): KnowledgeView {
  const k = world.systems.knowledge as unknown as KnowledgeState;
  return { evidence: k.evidence, interp: k.interp, task: k.task };
}
