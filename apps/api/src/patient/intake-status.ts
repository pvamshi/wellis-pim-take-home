/**
 * The 8 states an intake can be in (2.2), and the one definition of which
 * `intake_status` UPDATEs between them are legal.
 *
 * `INTAKE_TRANSITIONS` is read in exactly two places, and both compile it
 * rather than restate it: `IntakeStateMachine.transition()` attempts the
 * conditional UPDATE this describes, and `patient-triggers.ts` turns the same
 * map into the SQL that makes an illegal one fail even outside the service
 * (2.2's "impossible, not avoided" — a raw `UPDATE` against `patient` is
 * guarded exactly as the service's own write is, by the one trigger built
 * from this one map).
 */
export const INTAKE_STATUSES = [
  'draft',
  'submitted',
  'auto_cleared',
  'auto_flagged',
  'auto_rejected',
  'in_review',
  'approved',
  'rejected',
] as const;

export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

/**
 * Legal `(from, to)` pairs for `BEFORE UPDATE OF intake_status ON patient`
 * (2.2). A status with no entry here — `approved`, `rejected` — has no legal
 * next step: both are terminal, exactly as 2.2 states.
 */
export const INTAKE_TRANSITIONS: ReadonlyMap<IntakeStatus, ReadonlySet<IntakeStatus>> = new Map<
  IntakeStatus,
  ReadonlySet<IntakeStatus>
>([
  ['draft', new Set<IntakeStatus>(['submitted'])],
  ['submitted', new Set<IntakeStatus>(['auto_cleared', 'auto_flagged', 'auto_rejected'])],
  ['auto_cleared', new Set<IntakeStatus>(['in_review'])],
  ['auto_flagged', new Set<IntakeStatus>(['in_review'])],
  ['auto_rejected', new Set<IntakeStatus>(['in_review'])],
  ['in_review', new Set<IntakeStatus>(['approved', 'rejected'])],
]);

/** Where a patient row may be inserted at all (2.2): the origin fixes the only legal starting status. */
export type PatientOrigin = 'intake' | 'legacy';

/** The only `intake_status` each origin may be inserted with (2.2's `BEFORE INSERT`). */
export const INTAKE_INSERT_STATUS_BY_ORIGIN: Readonly<Record<PatientOrigin, IntakeStatus>> = {
  intake: 'draft',
  legacy: 'submitted',
};

/**
 * The two statuses a transition lands on that are a reviewer's decision
 * rather than a plain state change (2.2's "decide, note required"; 2.8's
 * `action` column, which is `decision` for these and `transition` for every
 * other UPDATE). Both are reachable only from `in_review`, so this set is
 * enough on its own to tell the two audit actions apart — no separate
 * "is this a decision" flag is threaded through the caller.
 */
export const DECISION_STATUSES: ReadonlySet<IntakeStatus> = new Set<IntakeStatus>([
  'approved',
  'rejected',
]);
