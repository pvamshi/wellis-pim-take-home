/**
 * The three legacy sources, named once.
 *
 * Both `RuleUpdate.table` (1.1.14) and `duplicate.source_table` (1.1.13) are
 * this same union, and it is the only place the three values are written down.
 * It lives in `legacy/` rather than in the rule contract because the duplicates
 * table names a source without any rule being involved — putting the union
 * under `rules/` would make duplicates depend on the rules engine for a fact
 * about the legacy export.
 *
 * These are the short names 1.1.14 prints, not the table names: the finding
 * says `patient`, the table it is against is `legacy_patient`. The mapping from
 * one to the other belongs to whatever persists a finding (1.1.3), not here.
 *
 * A type and nothing else. SQLite has no enum type, and the entities already
 * set the convention that the union is TypeScript's job, not the column's.
 */
export type LegacySourceTable = 'patient' | 'intake' | 'consent';
