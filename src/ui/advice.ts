/**
 * The one plain next step the plate offers. Every recommendation is drawn from the company's
 * recovery paths (sim/company/recovery.ts), so the game never advises something the company
 * cannot actually do: no "borrow" without credit, no "drill again" without the money.
 */
import { CONTRACT_DAYS, CONTRACT_PAY, CONTRACT_WAGES, COSTS, USED_RIG_PRICE, CAP_COST, type KnowledgeView, type OperationsView, type RecoveryPath } from "../sim";

export interface AdviceInput {
  ops: OperationsView;
  paths: RecoveryPath[];
  knowledge: Pick<KnowledgeView, "evidence">;
  formatDate: (t: number) => string;
  surveyName: (id: string) => string;
}

const usd = (cents: number) => "$" + Math.ceil(cents / 100).toLocaleString("en-US");
const borrowing = (cents: number) => (cents > 0 ? `, borrowing ${usd(cents)} from the bank (the books)` : "");

export function nextStep({ ops, paths, knowledge, formatDate, surveyName }: AdviceInput): string {
  if (ops.outcome.ended) return "The company is finished. Start a new campaign from the Campaign menu.";
  const w = ops.well;
  const find = <K extends RecoveryPath["kind"]>(kind: K) => paths.find((p): p is Extract<RecoveryPath, { kind: K }> => p.kind === kind);

  if (w && w.status === "rigging") return w.auto ? "The derrick is going up. The driller will start making hole when it is." : "The derrick is going up. Let the driller take over, or go to the rig and drill by hand.";
  if (w && w.status === "stuck") return "The tools are stuck. Go to the rig: fish for them, or abandon the hole.";
  if (w && w.status === "drilling") return w.auto ? `The driller is making hole. Each day costs $${COSTS.perDay}; watch the money.` : "Go to the rig and make hole, or let the driller work.";
  const contracted = find("contracted");
  if (contracted) return `The rig is out on contract until ${formatDate(contracted.until)}. The operator pays $${CONTRACT_PAY} when it comes back.`;

  if (w?.status === "gusher" && w.outcome?.startsWith("OIL") && !ops.production.producers.some((p) => p.wellId === w.id)) {
    const cap = find("cap");
    if (cap) return `You struck oil. Go to the rig and cap it for $${CAP_COST}${borrowing(cap.borrowCents)}; the oil sells each month.`;
  }
  if (ops.production.producers.length) return "The oil sells at each month's end. Lease more land and drill again when you are ready.";

  // Before the first well: how to find a place to drill.
  if (!w && ops.past.length === 0 && (find("drill") || find("leaseAndDrill"))) {
    const k = knowledge.evidence;
    if (!k.some((e) => e.kind === "walked")) return "Tap a survey near a hill and walk the ground. Look for gas bubbling, sour springs, a rise in the prairie.";
    if (!k.some((e) => e.kind === "surfaceSign" && e.sign !== "mound")) return "Walk more surveys. Gas and sour springs cluster where oil lies beneath.";
    return "Signs found. Lease the most promising survey and stake a well there, on the flank of the rise rather than its crown.";
  }

  const lead = w?.status === "dry" ? "A dry hole still teaches you the ground. " : w?.status === "gusher" ? "Gas has no buyer in 1890. " : "";
  const drill = find("drill"), lease = find("leaseAndDrill"), contract = find("contract"), rig = find("buyRig");
  if (drill) return `${lead}Choose a better spot on the ${surveyName(drill.surveyId)} lease and drill again${borrowing(drill.borrowCents)}.`;
  if (lease) return `${lead}Lease better ground (from ${usd(lease.leaseCents)}) and drill again${borrowing(lease.borrowCents)}.`;
  if (contract) return `${lead}There is not enough money for another well. Take a contract with the rig (the books): $${CONTRACT_WAGES} for the crew now, $${CONTRACT_PAY} in ${CONTRACT_DAYS} days${contract.borrowCents ? `, borrowing ${usd(contract.borrowCents)} for the wages` : ""}.`;
  if (rig) return `${lead}Buy a used rig ($${USED_RIG_PRICE}) in the books to work again${borrowing(rig.borrowCents)}.`;
  return `${lead}Wait for the month's end.`;
}
