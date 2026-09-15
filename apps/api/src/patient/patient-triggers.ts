import { INTAKE_INSERT_STATUS_BY_ORIGIN, INTAKE_TRANSITIONS } from './intake-status';

/**
 * The two `patient` triggers 2.2 asks for, compiled from `intake-status.ts`
 * rather than hand-listed here a second time.
 *
 * `CREATE TRIGGER IF NOT EXISTS` so booting twice against the same database
 * (every test suite, `just dev` after a restart) is a no-op the second time.
 * Like `synchronize: true` itself, this never *updates* a trigger that
 * already exists under this name — widening `INTAKE_TRANSITIONS` later needs
 * a manual `DROP TRIGGER` against any database that already has the old one,
 * the same migration-free trade-off the rest of this schema already accepts.
 */
export function patientTriggerStatements(): readonly string[] {
  return [intakeStatusTransitionTrigger(), intakeStatusInsertTrigger()];
}

/** `BEFORE UPDATE OF intake_status`: raises unless `(OLD, NEW)` is one of `INTAKE_TRANSITIONS`' pairs. */
function intakeStatusTransitionTrigger(): string {
  const legalPairs: string[] = [];

  for (const [from, targets] of INTAKE_TRANSITIONS) {
    for (const to of targets) {
      legalPairs.push(`(OLD.intake_status = '${from}' AND NEW.intake_status = '${to}')`);
    }
  }

  return `
    CREATE TRIGGER IF NOT EXISTS trg_patient_intake_status_transition
    BEFORE UPDATE OF intake_status ON patient
    FOR EACH ROW
    WHEN NOT (${legalPairs.join(' OR ')})
    BEGIN
      SELECT RAISE(ABORT, 'illegal intake_status transition');
    END;
  `;
}

/** `BEFORE INSERT`: raises unless the row's `origin` and `intake_status` are one of `INTAKE_INSERT_STATUS_BY_ORIGIN`'s pairs. */
function intakeStatusInsertTrigger(): string {
  const legalPairs = Object.entries(INTAKE_INSERT_STATUS_BY_ORIGIN).map(
    ([origin, status]) => `(NEW.origin = '${origin}' AND NEW.intake_status = '${status}')`,
  );

  return `
    CREATE TRIGGER IF NOT EXISTS trg_patient_insert_status
    BEFORE INSERT ON patient
    FOR EACH ROW
    WHEN NOT (${legalPairs.join(' OR ')})
    BEGIN
      SELECT RAISE(ABORT, 'illegal intake_status for this origin on insert');
    END;
  `;
}
