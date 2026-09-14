import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P55 — a patient's `status` written in a spelling this export is known to
 * use for one of the four canonical stages — `active`/`actief`,
 * `paused`/`gepauzeerd`, `churned`, `prospect` — in any case, where that
 * spelling is not already canonical.
 *
 * Not ambiguous: each spelling below names one stage and only one, in English
 * or in Dutch, so reading it is a lookup rather than a guess (1.1.12). A value
 * nobody recognises — `cancelled`, `opgezegd`, `lead`, `new`, `on hold` — is a
 * near-synonym, not a translation, and guessing which stage it means is P56's
 * refusal, not this rule's business; an empty cell is P57's.
 *
 * Tests `status` and changes `status` (1.1.5); the canonical value carries
 * none of the recognised spellings, so an approved row does not match again.
 */

/**
 * Every spelling this rule recognises, lower-cased, and the canonical value it
 * stands for — the English word each of the four stages already appears as
 * somewhere in the export, and the Dutch word where the export uses one.
 */
const CANONICAL_SPELLINGS = new Map<string, string>([
  ['active', 'active'],
  ['actief', 'active'],
  ['paused', 'paused'],
  ['gepauzeerd', 'paused'],
  ['churned', 'churned'],
  ['prospect', 'prospect'],
]);

export const p55: CatalogueRule = {
  ruleId: 'P55',
  version: 1,
  ruleName: 'Patient status is a recognised spelling that is not canonical',
  description:
    "This patient's status is written in a spelling the old system used for one of the " +
    'four stages this column tracks — active, paused, churned or prospect, in English or ' +
    'in Dutch, in any case — rather than in the canonical form. The same stage, written ' +
    'canonically, is proposed. A value nobody recognises is not touched here, and nothing ' +
    'is guessed.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.status;
      if (previous === null) continue; // P57's finding.

      const canonical = CANONICAL_SPELLINGS.get(previous.trim().toLowerCase());
      if (canonical === undefined) continue; // P56's finding, or P57's if blank.
      if (canonical === previous) continue; // Already exactly canonical.

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'status',
        prev: previous,
        next: canonical,
      });
    }

    return { ambiguity: false, updates };
  },
};
