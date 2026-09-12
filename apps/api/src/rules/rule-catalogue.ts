import type { RegisteredRule } from './rule-contract';

/**
 * Every `(ruleId, version)` the codebase has code for.
 *
 * An explicit list, not a directory scan and not decorators. Old versions stay
 * registered forever (1.1.1, 1.1.8) because the rule rows already written — and
 * the modification log that reads them (1.3) — point at them by version; a
 * convention that scans the filesystem loses a version the moment someone
 * tidies a file away, and loses it silently. An entry here means deleting code
 * is a visible diff.
 *
 * Entries are appended, never removed and never renumbered. A new version of a
 * rule is a new entry alongside the old one, not an edit to it.
 *
 * Empty on purpose. This body of work is the infrastructure rules run on, not
 * the rules; tests register fakes of their own. An example rule sitting here
 * would run on every press of "Apply rules" (1.2.10) and produce findings
 * nobody asked for (1.1.11).
 */
export const ruleCatalogue: readonly RegisteredRule[] = [];
