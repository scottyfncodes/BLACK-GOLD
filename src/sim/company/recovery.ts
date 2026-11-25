/**
 * What the company can still do: the single source of truth for "is there a way forward?"
 *
 * The campaign ends when this returns no path, and every piece of advice the game gives is
 * drawn from it, so the game never recommends something the company cannot do. Bankruptcy is
 * a real outcome: a company that borrows to the limit and spends it can run out of paths.
 * Pure and public: it reads the company's position only. Imports no truth.
 */
import { BORROW_STEP_CENTS, USED_RIG_PRICE } from "./bank";
import { CAP_COST } from "./production";

/** A month's contract drilling for another operator, with the company's own rig. */
export const CONTRACT_DAYS = 30;
/** Paid up front: the crew's wages and fuel for the month. */
export const CONTRACT_WAGES = 150;
/** Paid by the operator when the job is done. */
export const CONTRACT_PAY = 400;
/** The least a fresh attempt needs: a derrick and fifteen days of rig time. */
export const MIN_ATTEMPT_DAYS = 15;

export type RecoveryPath =
  | { kind: "producing" }
  | { kind: "drilling" }
  | { kind: "contracted"; until: number }
  | { kind: "cap"; borrowCents: number }
  | { kind: "drill"; surveyId: string; borrowCents: number }
  | { kind: "leaseAndDrill"; surveyId: string; leaseCents: number; borrowCents: number }
  | { kind: "contract"; borrowCents: number }
  | { kind: "buyRig"; borrowCents: number };

/** The company's position, in cents. Everything here is the company's own, public information. */
export interface Position {
  cashCents: number;
  /** What the bank would lend now, beyond the current debt. */
  creditRoomCents: number;
  /** What the bank would lend beyond the debt if the company owned a rig (for buying one). */
  creditRoomWithRigCents: number;
  rigOwned: boolean;
  producers: number;
  wellActive: boolean;
  uncappedOil: boolean;
  contractUntil: number | null;
  heldLeases: string[];
  /** The cheapest lease on offer, if one is needed. */
  cheapestLease: (() => { surveyId: string; cents: number } | null) | null;
  derrickCents: number;
  dayCents: number;
}

/** Whole borrowing steps needed to have `needCents` in hand. */
const borrowFor = (needCents: number, cashCents: number) => Math.max(0, Math.ceil((needCents - cashCents) / BORROW_STEP_CENTS) * BORROW_STEP_CENTS);

/** The cost of a fresh attempt on land already held: a derrick and fifteen days. */
export const attemptCents = (p: Pick<Position, "derrickCents" | "dayCents">) => p.derrickCents + MIN_ATTEMPT_DAYS * p.dayCents;

/** Contract work is for lean times: the company takes it while it cannot afford a well of its own. */
export const contractOffered = (p: Pick<Position, "cashCents" | "derrickCents" | "dayCents">) => p.cashCents < attemptCents(p);

export function recoveryPaths(p: Position): RecoveryPath[] {
  const out: RecoveryPath[] = [];
  if (p.producers > 0) out.push({ kind: "producing" });
  if (p.wellActive) out.push({ kind: "drilling" });
  if (p.contractUntil !== null) out.push({ kind: "contracted", until: p.contractUntil });
  const canHave = (need: number, room = p.creditRoomCents) => { const b = borrowFor(need, p.cashCents); return b <= room ? b : -1; };
  if (p.uncappedOil) {
    const b = canHave(CAP_COST * 100);
    if (b >= 0) out.push({ kind: "cap", borrowCents: b });
  }
  if (p.rigOwned && !p.wellActive && p.contractUntil === null) {
    const attempt = attemptCents(p);
    const held = p.heldLeases[0];
    if (held !== undefined) {
      const b = canHave(attempt);
      if (b >= 0) out.push({ kind: "drill", surveyId: held, borrowCents: b });
    } else {
      const lease = p.cheapestLease?.();
      if (lease) {
        const b = canHave(attempt + lease.cents);
        if (b >= 0) out.push({ kind: "leaseAndDrill", surveyId: lease.surveyId, leaseCents: lease.cents, borrowCents: b });
      }
    }
    if (contractOffered(p)) {
      const b = canHave(CONTRACT_WAGES * 100);
      if (b >= 0) out.push({ kind: "contract", borrowCents: b });
    }
  }
  if (!p.rigOwned) {
    // Buy a used rig, then take contract work (or drill) with it.
    const b = canHave(USED_RIG_PRICE * 100);
    const after = p.cashCents + b - USED_RIG_PRICE * 100;
    const roomAfter = p.creditRoomWithRigCents - b;
    if (b >= 0 && after + roomAfter >= CONTRACT_WAGES * 100) out.push({ kind: "buyRig", borrowCents: b });
  }
  return out;
}
