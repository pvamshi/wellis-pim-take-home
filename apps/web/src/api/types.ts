/**
 * The backend's /health response.
 *
 * Deliberately permissive: the backend is being built in parallel and has not
 * fixed its response body, so the page renders whatever comes back instead of
 * depending on a field that may not exist.
 */
export type HealthResponse = { status?: string; [key: string]: unknown };

/**
 * One line of the rules screen: a rule whose active version has work waiting
 * (1.2.1).
 *
 * The backend's `RuleListEntry` (`apps/api/src/rules/rule-list.service.ts`) is
 * the source of truth for these four fields; this is a restatement of it, not a
 * second definition. The workspaces are `apps/*` only, so there is no shared
 * package to import the interface from — `HealthResponse` above set that
 * precedent.
 *
 * Unlike `HealthResponse` this one is exact rather than permissive: the
 * endpoint it mirrors is built, and its fields are fixed. If the two ever
 * disagree, the backend is right and this file is the bug.
 */
export interface RuleListEntry {
  readonly ruleId: string;
  readonly ruleName: string;
  /** The active version, and so the version the count belongs to (1.1.8). */
  readonly version: number;
  /** Rows of this rule and version still awaiting a decision. Never zero. */
  readonly pending: number;
  /**
   * Whether this rule proposes values or only reports what it cannot fix
   * (1.1.12). On the list so a line can say so before it is opened: an
   * ambiguous rule's pending count is work per row, not a batch to tick.
   */
  readonly ambiguous: boolean;
}

/**
 * The backend's `GET /rules` response: a bare array, already filtered to active
 * versions with pending rows and already sorted most-pending-first (1.2.1).
 */
export type RulesListResponse = RuleListEntry[];

/** Which legacy source a finding is against (1.1.14). */
export type LegacySourceTable = 'patient' | 'intake' | 'consent';

/**
 * One row of an expanded rule (1.2.2), before and after (1.2.3).
 *
 * A restatement of the backend's `RuleDetailRow`
 * (`apps/api/src/rules/rule-detail.service.ts`), exactly as `RuleListEntry`
 * above restates the list's row: the backend owns the shape, and if the two
 * disagree this file is the bug.
 *
 * `ruleId` and `version` are deliberately not here. They are the same on every
 * row of one detail, so they sit on the detail once — and a row action takes
 * the rule id and the version from there, which is what makes
 * `(table, legacyId, column)` plus the detail a complete row address.
 */
export interface RuleDetailRow {
  readonly table: LegacySourceTable;
  /** Theirs, and not unique (1.0.3) — it names a row, it does not identify one. */
  readonly legacyId: string;
  /** The column the rule tested, and so the column it changes (1.1.5). */
  readonly column: string;
  /** What that column held when the rule ran. Null when it held nothing. */
  readonly previousValue: string | null;
  /**
   * What the rule proposes instead — the key is absent entirely on an ambiguous
   * rule (1.1.12, 1.2.3), whose rows have no proposed value at all.
   *
   * Optional rather than `string | null`, because null is a value a rule may
   * legitimately propose: clearing a column. The screen must be able to tell
   * "there is no fix, read the description" from "the fix is to empty this
   * column", so it reads `ambiguous` on the detail and never infers it here.
   */
  readonly nextValue?: string | null;
}

/**
 * One expanded rule: what it is, and its two sections (1.2.2).
 *
 * `description` and `ambiguous` are what 1.2.3's second sentence needs — an
 * ambiguous rule's rows show the previous value and the rule's description in
 * place of a new value. They are on the detail rather than on each row because
 * ambiguity is a property of the rule, never of the row (1.1.12).
 */
export interface RuleDetailResponse {
  readonly ruleId: string;
  readonly ruleName: string;
  /** For an ambiguous rule, what the human reads instead of a value (1.1.12). */
  readonly description: string;
  /** True when this rule finds problems it cannot fix (1.1.12). */
  readonly ambiguous: boolean;
  /**
   * The active version, and so the version both sections belong to (1.1.8).
   * Null when the rule has no active version — declined and not yet revised
   * (1.2.6), in which case both sections are empty.
   */
  readonly version: number | null;
  /** Rows still awaiting a decision (1.2.2). */
  readonly pending: RuleDetailRow[];
  /** Rows already approved and applied (1.2.2). */
  readonly approved: RuleDetailRow[];
}

/**
 * A rule row's address, minus the rule id the URL carries.
 *
 * Rule rows have no surrogate id: `(legacyId, ruleId, version, column)` is the
 * primary key, so this is the only way a press can name one row (1.2.4, 1.2.7).
 * The version is the detail's active version, which is the version both
 * sections were read from.
 */
export interface RuleRowAddress {
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  /** Integer, matching `rule_version.version`. */
  readonly version: number;
  readonly column: string;
}

/**
 * What one press of Approve did (1.2.4), at either level.
 *
 * Informational. The screen's state always comes from re-reading the detail and
 * the list; this body is what the one-line outcome above the list is built
 * from, which is the only way a rule-level press stays visible after the rule
 * leaves the list (1.2.1).
 */
export interface ApproveReport {
  readonly ruleId: string;
  /** Null only when a rule-level press found no active version to act on. */
  readonly version: number | null;
  /** Rule rows moved from pending to approved. */
  readonly approved: number;
  /**
   * Legacy data rows written. It can exceed `approved`: a finding addresses a
   * legacy id and two data rows may share one (1.0.3).
   */
  readonly updated: number;
}

/** What one press of Decline on a rule did (1.2.6). Informational. */
export interface RuleDeclineReport {
  readonly ruleId: string;
  /** The version that went inactive. Null when there was no active version. */
  readonly version: number | null;
  /** The reason stored on that version, or null when none was given (1.2.6). */
  readonly reason: string | null;
}

/** What one press of the cross on a single row did (1.2.7). Informational. */
export interface RowDeclineReport {
  readonly ruleId: string;
  /** Never null: a row-level press names the version in its address. */
  readonly version: number;
  /** Rule rows moved to declined: one, or none when the row was already settled. */
  readonly declined: number;
  /** The reason stored on that row, or null when none was given (1.2.7). */
  readonly reason: string | null;
}

/**
 * What one press of the cross with "modify the rule" ticked did (1.2.8).
 * Informational.
 *
 * A restatement of the backend's `ReviseFromRowResponse`
 * (`apps/api/src/decline/decline.controller.ts`), exactly as the reports above
 * restate theirs: the backend owns the shape, and if the two disagree this file
 * is the bug.
 *
 * Written out flat rather than as `extends RuleDeclineReport`, although the
 * backend declares it that way. The two are the same three fields plus `row`,
 * and the contract spec that holds this copy to the endpoint reads these
 * declarations as text — an inherited field would not be in the text it reads,
 * so a field that moved would stop being checked.
 *
 * This press decides no row at all, which is the whole of 1.2.8: `row` is the
 * address that was sent, echoed back so the caller can see the press it made is
 * the press that landed. The row it names is still pending.
 */
export interface ReviseFromRowReport {
  readonly ruleId: string;
  /**
   * The version that was parked — the rule's active version, made inactive with
   * `needsReview` true. Null when there was no active version to park.
   */
  readonly version: number | null;
  /** The reason stored on that version, or null when none was given (1.2.8). */
  readonly reason: string | null;
  /** The address the press named, echoed back. Nothing was written from it. */
  readonly row: RuleRowAddress;
}

/**
 * What one active rule version's share of a run did (1.2.10).
 *
 * A restatement of the backend's `RuleFindingsReportEntry`
 * (`apps/api/src/rules/rule-findings.service.ts`), exactly as the reports above
 * restate theirs: the backend owns the shape, and if the two disagree this file
 * is the bug.
 *
 * The four counters reconcile by construction — `found = declined + repeated +
 * written` — so a run is checked by comparing counts rather than by tracing
 * rows. The three link counters reconcile the same way: `linksFound =
 * linksRecorded + linksSkipped` (1.7.2).
 */
export interface ApplyRulesRuleLine {
  readonly ruleId: string;
  /** The active version that ran, and so the version its rows belong to. */
  readonly version: number;
  /** Updates the rule returned. */
  readonly found: number;
  /** Dropped because the row is declined for this rule and column (1.2.9). */
  readonly declined: number;
  /** Dropped because that exact address is already recorded. */
  readonly repeated: number;
  /** Written as new pending rows. */
  readonly written: number;
  /** Duplicate links the rule returned (1.7.2). */
  readonly linksFound: number;
  /** Written as new pending links. */
  readonly linksRecorded: number;
  /** Dropped because that pair of rows is already linked, in any status (1.7.2). */
  readonly linksSkipped: number;
}

/**
 * The same four counters summed over the whole run, plus how many versions ran.
 *
 * Written out flat rather than inline inside `ApplyRulesReport`, although the
 * backend declares it that way. The contract spec that holds this copy to the
 * endpoint reads these declarations as text, one field to a line — a nested
 * object literal spanning lines is not something it can read.
 */
export interface ApplyRulesTotals {
  /** Active versions the run called. Zero when no version is active at all. */
  readonly versionsRun: number;
  readonly found: number;
  readonly declined: number;
  readonly repeated: number;
  readonly written: number;
}

/**
 * What one press of "Apply rules" did (1.2.10). Informational.
 *
 * The screen refreshes by re-reading the list and the expanded rule, never from
 * this body — it is what the one-line run summary above the list is built from,
 * exactly as the press reports above are.
 */
export interface ApplyRulesReport {
  /** One line per active version, in the order the runner called them. */
  readonly rules: ApplyRulesRuleLine[];
  readonly totals: ApplyRulesTotals;
}

/** The four states a row can be in (1.6.1, 1.6.2, and B7's `imported`, 2.6). Precedence: imported > rejected > pending > clean. */
export type RowState = 'imported' | 'pending' | 'clean' | 'rejected';

/**
 * One line of the rows screen (1.6.1): a legacy row and the state it is in.
 *
 * A restatement of the backend's `RowListEntry`
 * (`apps/api/src/rules/row-list.service.ts`), exactly as `RuleListEntry`
 * above restates the rules screen's own line.
 */
export interface RowListEntry {
  readonly table: LegacySourceTable;
  /** Theirs, and not unique (1.0.3) — this line names a row, not a person. */
  readonly legacyId: string;
  readonly state: RowState;
}

/**
 * The backend's `GET /rows` response: every row the current filter matches, and
 * how many that is (1.6.1).
 *
 * Not a page. The screen virtualises the list, so it draws only the rows on
 * screen however many come back, and a page size would be a limit the reader
 * could not scroll past.
 */
export interface RowsListResponse {
  readonly rows: RowListEntry[];
  readonly total: number;
}

/**
 * One physical legacy row's own column values (1.6.3), keyed by the database
 * column name — `full_name`, not `fullName` — matching a finding's own
 * `column` field.
 *
 * A restatement of the backend's `LegacyRowValues`
 * (`apps/api/src/rules/row-detail.service.ts`).
 */
export type LegacyRowValues = Record<string, string | null>;

/**
 * One finding on the rows screen (1.6.3) — the same `column`, `previousValue`
 * and optional `nextValue` `RuleDetailRow` carries, minus `table` and
 * `legacyId`, which are this whole response's fixed context (the URL).
 *
 * A restatement of the backend's `RowDetailFinding`.
 */
export interface RowDetailFinding {
  readonly column: string;
  readonly previousValue: string | null;
  /** Absent, not null, exactly when the rule behind it is ambiguous (1.1.12). */
  readonly nextValue?: string | null;
}

/**
 * One rule's findings against one row (1.6.3), bucketed into what is still
 * waiting and what is already settled.
 *
 * A restatement of the backend's `RowDetailRuleGroup`. `settled` holds
 * approved and declined findings together, each with its own `status`.
 */
export interface RowDetailRuleGroup {
  readonly ruleId: string;
  readonly ruleName: string;
  /** For an ambiguous rule, what the human reads instead of a value (1.1.12). */
  readonly description: string;
  readonly ambiguous: boolean;
  /** The one version every finding in this group belongs to. */
  readonly version: number;
  /** Findings still awaiting a decision (1.6.3). Empty when there are none. */
  readonly pending: RowDetailFinding[];
  /** Findings already approved or declined. Empty when there are none. */
  readonly settled: RowDetailSettledFinding[];
}

/** A finding already decided, for the row's log. A restatement of the backend's `RowDetailSettledFinding`. */
export interface RowDetailSettledFinding {
  readonly column: string;
  readonly previousValue: string | null;
  /** What the rule proposed or, on an ambiguous rule, what a human supplied; null when nothing was. */
  readonly nextValue: string | null;
  /** Approved wrote `nextValue` to the row; declined kept `previousValue`. */
  readonly status: 'approved' | 'declined';
}

/**
 * Everything waiting on one row (1.6.3): its own values, and its findings
 * grouped by the rule that made them.
 *
 * A restatement of the backend's `RowDetail`, the `GET /rows/:table/:legacyId`
 * response.
 */
export interface RowDetailResponse {
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  /**
   * Every physical legacy row sharing this legacy id (1.0.3) — a legacy id
   * names a row without identifying one.
   */
  readonly dataRows: LegacyRowValues[];
  /** This row's findings, grouped by the rule that made them (1.6.3). */
  readonly findings: RowDetailRuleGroup[];
}

/**
 * What one press of Approve all on a row did (1.6.4). Informational — the
 * screen always re-reads the detail and the list after a press.
 */
export interface RowApproveAllReport {
  readonly table: string;
  readonly legacyId: string;
  /** Rule rows moved from pending to approved — the ones that proposed a value. */
  readonly approved: number;
  /** Legacy data rows written. Can exceed `approved` (1.0.3). */
  readonly updated: number;
  /**
   * Pending findings left pending because the rule behind them is ambiguous
   * and proposed no value (1.1.12) — reported so the press never looks like
   * it finished a row it did not.
   */
  readonly skipped: number;
}

/** What one press of Decline all on a row did (1.6.5). Informational. */
export interface RowDeclineAllReport {
  readonly table: string;
  readonly legacyId: string;
  /** Every pending rule row this press moved to declined, ambiguous included. */
  readonly declined: number;
  /**
   * The reason stored on every one of them, or null when none was given. Null
   * too when nothing was declined, because then nothing was stored.
   */
  readonly reason: string | null;
}

/** What a reject or an un-reject press left the row as (1.6.6). Informational. */
export interface RowRejectionReport {
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  readonly rejected: boolean;
  /** The reason on record, or null. Always null after `unreject` — the row is gone. */
  readonly reason: string | null;
}

/**
 * What one hand edit did (1.6.7): the address, and both sides of the change.
 * Informational.
 */
export interface RowEditReport {
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  /** The database column written, e.g. `full_name`. */
  readonly column: string;
  /** What the column held before this edit. Null when it held nothing. */
  readonly previousValue: string | null;
  /** What was written. Null clears the column (1.2.13's "a blank box is an answer"). */
  readonly nextValue: string | null;
  /** Always the reserved hand-edit rule id — legible as a hand edit because of it. */
  readonly ruleId: string;
  /** The finding's own version, unique per `(legacyId, ruleId, column)`. */
  readonly version: number;
}

/** A link's status (1.7.3). `pending` → `confirmed` | `dismissed`, both final. */
export type DuplicateStatus = 'pending' | 'confirmed' | 'dismissed';

/**
 * One physical row's own column values (1.7.4), keyed by database column
 * name, matching `LegacyRowValues`'s own shape.
 *
 * A restatement of the backend's `DuplicateRowValues`
 * (`apps/api/src/rules/duplicate-detail.service.ts`), declared fresh rather
 * than reused as an alias of `LegacyRowValues` — the backend's own comment on
 * that type makes the same choice, deliberately, for the same reason.
 */
export type DuplicateRowValues = Record<string, string | null>;

/**
 * One line of the duplicates screen (1.7.4): source, X, Y, and the rule that
 * found the link.
 *
 * A restatement of the backend's `DuplicateListEntry`
 * (`apps/api/src/rules/duplicate-list.service.ts`).
 */
export interface DuplicateListEntry {
  readonly id: string;
  readonly table: LegacySourceTable;
  /** X — the id that duplicates, as a human reads it. */
  readonly duplicateLegacyId: string;
  /** Y — the one that survives, as a human reads it. */
  readonly canonicalLegacyId: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly status: DuplicateStatus;
}

/**
 * The backend's `GET /duplicates` response: every link the current filter
 * matches, and how many there are in all (1.7.4).
 *
 * Not a page, for the same reason `RowsListResponse` is not: the screen
 * virtualises the list.
 */
export interface DuplicatesListResponse {
  readonly links: DuplicateListEntry[];
  readonly total: number;
}

/**
 * One side of an expanded link (1.7.4): the id as a human reads it, and that
 * row's own values.
 *
 * A restatement of the backend's `DuplicateDetailRow`.
 */
export interface DuplicateDetailRow {
  readonly legacyId: string;
  readonly values: DuplicateRowValues;
}

/**
 * A link expanded (1.7.4): both physical rows, side by side, every column.
 *
 * A restatement of the backend's `DuplicateDetail`
 * (`apps/api/src/rules/duplicate-detail.service.ts`), the `GET
 * /duplicates/:id` response.
 */
export interface DuplicateDetail {
  readonly id: string;
  readonly table: LegacySourceTable;
  readonly status: DuplicateStatus;
  readonly ruleId: string;
  readonly ruleName: string;
  /** Integer, matching `rule_version.version` — the version that found this link. */
  readonly version: number;
  /** X — the row that duplicates. */
  readonly duplicate: DuplicateDetailRow;
  /** Y — the one that survives. */
  readonly canonical: DuplicateDetailRow;
}

/**
 * What one press of Confirm did (1.7.5). Informational — the panel always
 * re-reads the detail after a press.
 *
 * A restatement of the backend's `DuplicateConfirmReport`
 * (`apps/api/src/rules/duplicate-decisions.service.ts`).
 */
export interface DuplicateConfirmReport {
  readonly outcome: 'confirmed';
  readonly id: string;
  readonly status: 'confirmed';
  /** True only for a patient link, where confirming also rejects X (1.7.5). */
  readonly rejected: boolean;
}

/**
 * What one press of Dismiss did (1.7.6). Informational.
 *
 * A restatement of the backend's `DuplicateDismissReport`.
 */
export interface DuplicateDismissReport {
  readonly outcome: 'dismissed';
  readonly id: string;
  readonly status: 'dismissed';
}

// === B5/B6/B7: intake, review and import ====================================

/**
 * One field that failed 2.5's rules — the 422 body's own shape (2.9: `{
 * message, errors: [{ field, value, reason }] }`).
 *
 * A restatement of the backend's `FieldError`
 * (`apps/api/src/patient/validation/field-error.ts`). `field` is nullable for
 * a row that fails a precondition rather than a field rule (2.6): individual
 * and bulk import both read that as `{ field: null, value: null, reason }`.
 */
export interface FieldError {
  readonly field: string | null;
  readonly value: unknown;
  readonly reason: string;
}

/** The intake form's five validated steps (2.3.1); step 6 is Check-and-submit and validates nothing of its own. */
export type IntakeStep = 1 | 2 | 3 | 4 | 5;

/**
 * A patient row's questionnaire fields, keyed the way 2.3.1 and the backend's
 * `PatientAnswers` (`apps/api/src/patient/patient-answers.ts`) name them.
 *
 * A restatement, exactly as `RuleListEntry` restates its own backend type: if
 * the two disagree, the backend is right and this file is the bug.
 */
export interface PatientAnswers {
  readonly full_name: string;
  readonly email: string;
  readonly date_of_birth: string;
  readonly height_cm: number | null;
  readonly weight_kg: number | null;
  readonly glp1_current: boolean | null;
  readonly glp1_medications: readonly string[] | null;
  readonly other_medications: string | null;
  readonly weight_conditions: readonly string[] | null;
  readonly thyroid_cancer_history: boolean | null;
  readonly pancreatitis_history: boolean | null;
  readonly other_conditions: string | null;
  readonly alcohol_units_week: number | null;
  readonly consent_data_processing: boolean;
}

/** What a patient reads back (2.3, 2.9): never the outcome, never a BMI — every status from `submitted` on collapses into `received`. */
export type IntakePatientStatus = 'draft' | 'received';

/** The backend's `IntakeView` — every intake read and write answers with this shape. */
export interface IntakeView {
  readonly id: string;
  readonly status: IntakePatientStatus;
  readonly answers: PatientAnswers;
}

/** The 8 states an intake can be in (2.2) — a restatement of the backend's `IntakeStatus`. */
export type IntakeStatus =
  | 'draft'
  | 'submitted'
  | 'auto_cleared'
  | 'auto_flagged'
  | 'auto_rejected'
  | 'in_review'
  | 'approved'
  | 'rejected';

/** Where a patient row came from (2.0) — a restatement of the backend's `PatientOrigin`. */
export type PatientOrigin = 'intake' | 'legacy';

/** One `elig-1` rule's stored result (2.7) — a restatement of the backend's `EvaluationEntry` on `patient.evaluation`. */
export interface EvaluationEntry {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly outcome: 'reject' | 'flag';
  readonly explanation: string;
}

/** The two tables an audit event can be about (2.8) — a restatement of the backend's `AuditEntity`. */
export type AuditEntity = 'patient' | 'consent_event';

/** How a `patient`/`consent_event` row came to be, or changed (2.8) — a restatement of the backend's `AuditAction`. */
export type AuditAction = 'create' | 'import' | 'transition' | 'decision';

/** One line of status history (2.4, 2.8) — a restatement of the backend's `AuditEvent` entity. */
export interface AuditEvent {
  readonly id: string;
  readonly entity: AuditEntity;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly actor: string;
  readonly reason: string | null;
  readonly at: string;
}

/** One answer, with whether it was ever asked (2.4: "not-recorded answers marked for legacy rows"). */
export interface RecordedAnswer<T> {
  readonly value: T;
  readonly recorded: boolean;
}

/** The review detail's answers, grouped by questionnaire step (2.4) — a restatement of the backend's `ReviewAnswers`. */
export interface ReviewAnswers {
  readonly step1: {
    readonly full_name: RecordedAnswer<string>;
    readonly email: RecordedAnswer<string>;
    readonly date_of_birth: RecordedAnswer<string>;
  };
  readonly step2: {
    readonly height_cm: RecordedAnswer<number | null>;
    readonly weight_kg: RecordedAnswer<number | null>;
  };
  readonly step3: {
    readonly glp1_current: RecordedAnswer<boolean | null>;
    readonly glp1_medications: RecordedAnswer<readonly string[] | null>;
    readonly other_medications: RecordedAnswer<string | null>;
  };
  readonly step4: {
    readonly weight_conditions: RecordedAnswer<readonly string[] | null>;
    readonly thyroid_cancer_history: RecordedAnswer<boolean | null>;
    readonly pancreatitis_history: RecordedAnswer<boolean | null>;
    readonly other_conditions: RecordedAnswer<string | null>;
    readonly alcohol_units_week: RecordedAnswer<number | null>;
  };
  readonly step5: {
    readonly consent_data_processing: RecordedAnswer<boolean>;
  };
}

/** One line of the review queue (2.4) — a restatement of the backend's `ReviewQueueEntry`. */
export interface ReviewQueueEntry {
  readonly id: string;
  readonly submittedAt: string | null;
  readonly origin: PatientOrigin;
  readonly age: number;
  readonly bmi: number | null;
  readonly status: IntakeStatus;
  /** Every rule id that matched (2.7) — flag and reject alike, the "matched flags" column. */
  readonly matchedRuleIds: string[];
}

/** One row expanded (2.4) — a restatement of the backend's `ReviewDetail`. */
export interface ReviewDetail {
  readonly id: string;
  readonly origin: PatientOrigin;
  readonly status: IntakeStatus;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  readonly age: number;
  readonly answers: ReviewAnswers;
  readonly evaluation: {
    readonly rulesetVersion: string | null;
    readonly results: EvaluationEntry[];
  };
  /** Status history (2.4), oldest first. */
  readonly history: AuditEvent[];
}

/** What Start review / Approve / Reject hand back (2.4) — a restatement of the backend's `ReviewStatusResponse`. */
export interface ReviewStatusResponse {
  readonly id: string;
  readonly status: IntakeStatus;
}

/** What one individual import did (2.6, 2.9) — a restatement of the backend's `LegacyPatientImportResponse`. */
export interface LegacyPatientImportResponse {
  readonly imported: true;
  readonly patientId: string;
  readonly intakeStatus: string;
}

/**
 * One row's own outcome from a bulk import (2.6): imported, or not with every
 * field error collected in one pass. A restatement of the backend's
 * `BulkImportRowResult` (`apps/api/src/legacy-patient-import/legacy-patient-import.service.ts`).
 */
export type BulkImportRowResult =
  | {
      readonly legacyId: string;
      readonly imported: true;
      readonly patientId: string;
      readonly intakeStatus: IntakeStatus;
    }
  | { readonly legacyId: string; readonly imported: false; readonly errors: FieldError[] };
