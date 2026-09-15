/**
 * `audit_event` is append-only (2.8): these two triggers are what makes that
 * true rather than merely convention, exactly the way `patient-triggers.ts`
 * backs 2.2's state machine. `CREATE TRIGGER IF NOT EXISTS` for the same
 * reason as there — idempotent across every boot and every test suite.
 */
export function auditTriggerStatements(): readonly string[] {
  return [
    `
    CREATE TRIGGER IF NOT EXISTS trg_audit_event_no_update
    BEFORE UPDATE ON audit_event
    BEGIN
      SELECT RAISE(ABORT, 'audit_event is append-only: UPDATE is not allowed');
    END;
  `,
    `
    CREATE TRIGGER IF NOT EXISTS trg_audit_event_no_delete
    BEFORE DELETE ON audit_event
    BEGIN
      SELECT RAISE(ABORT, 'audit_event is append-only: DELETE is not allowed');
    END;
  `,
  ];
}
