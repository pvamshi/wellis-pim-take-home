import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P03 — a patient's `full_name` padded at the ends or spaced out inside.
 *
 * A name is what a human reads on every screen and what the duplicate rules
 * compare on, so `"Jan  de Vries "` and `"Jan de Vries"` are the same person
 * printed two ways and not the same string anywhere. Whitespace is also the one
 * defect in a name that carries no information: no reading of the row is lost by
 * removing it, which is what separates this rule from every other `full_name`
 * entry in the catalogue.
 *
 * Not ambiguous: the cleaned name is the only reading of a padded one.
 *
 * Whitespace only, and nothing else. The name it proposes may still be shouted
 * in capitals (P04), still be comma-inverted (P05), still carry `Dhr.` in front
 * of it (P06) — those are their own rules and their own approvals (1.1.4). This
 * one hands them a name whose spacing is no longer in the way.
 */

/** Any run of whitespace: ordinary spaces, tabs, newlines, non-breaking spaces. */
const WHITESPACE_RUN = /\s+/g;

/**
 * Trimmed at both ends, and every inner run of whitespace reduced to one space.
 *
 * The catalogue says "leading, trailing or doubled internal whitespace" and
 * asks for "the cleaned name", which is this one operation stated three ways —
 * `"  Jan   de Vries "` and `"Jan\tde Vries"` are the same defect in different
 * clothes, and a single rule that normalises spacing is still one fix (1.1.4).
 * Treating a lone inner tab as a fourth case for some later rule would leave it
 * with no rule at all.
 *
 * It replaces with a plain space rather than preserving whichever character was
 * there: a name separated by a tab is not a name whose separator is worth
 * keeping.
 */
function cleaned(value: string): string {
  return value.trim().replace(WHITESPACE_RUN, ' ');
}

export const p03: CatalogueRule = {
  ruleId: 'P03',
  version: 1,
  ruleName: 'Patient name has stray whitespace',
  description:
    "The patient's name has whitespace before it, after it, or doubled inside it. The " +
    'cleaned name is proposed — the same name with its ends trimmed and each run of ' +
    'spacing reduced to one space, and nothing else about it changed.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every name that would
   * change (1.1.14). Tests `full_name` and changes `full_name` (1.1.5), so an
   * approved row stops matching the next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.fullName;

      // The column holds nothing at all. An absent name is P08's finding, and
      // there is no whitespace here to clean (1.1.4).
      if (previous === null) {
        continue;
      }

      const next = cleaned(previous);

      // Nothing to propose when the name is already clean.
      if (next === previous) {
        continue;
      }

      // Nothing but whitespace, so the clean leaves nothing. Proposing an empty
      // name would be proposing the very state P08 calls an empty name and asks
      // a human about — so this rule walks past it, exactly as P01 walks past an
      // id that is only padding.
      if (next.length === 0) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `full_name`, so
        // the id is only the address — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'full_name',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
