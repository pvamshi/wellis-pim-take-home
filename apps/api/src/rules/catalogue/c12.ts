import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C12 — a consent's `version` naming a real consent-text version this export
 * has — `v1` or `v2` — in a loose spelling: any case, the bare number, the
 * word `version`, or a trailing `.0`.
 *
 * Not ambiguous: each loose spelling names one version and only one, so
 * reading it is a lookup rather than a guess (1.1.12). A label naming no
 * version this export has is out of scope here; an empty cell is C13's.
 *
 * Tests `version` and changes it (1.1.5); the canonical label carries none
 * of the loose spellings, so an approved row does not match again.
 */

/** Optional `version` word, optional `v`, the digits, optional trailing
 * `.0` — the four loose shapes this rule reads: `V2`, `2`, `version 2`,
 * `v2.0`. Applied to the cell already trimmed and lower-cased. */
const LOOSE_VERSION = /^(?:version\s*)?v?(\d+)(?:\.0)?$/;

/** The consent-text versions this export actually has. A number outside
 * this set is a label shaped like a version that names none that exist. */
const KNOWN_VERSIONS = new Set(['v1', 'v2']);

export const c12: CatalogueRule = {
  ruleId: 'C12',
  version: 1,
  ruleName: 'Consent version is a recognised form written loosely',
  description:
    "This consent's version names a real consent-text version — v1 or v2 — but not in " +
    'the canonical spelling: a different case, a bare number, the word "version", or a ' +
    'trailing .0. The same version, written canonically, is proposed. A label naming no ' +
    'version this export has is not touched here, and nothing is guessed.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.version;
      if (previous === null) continue; // C13's finding.

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // C13's finding.

      const matched = LOOSE_VERSION.exec(trimmed.toLowerCase());
      if (matched === null) continue; // Not version-shaped at all.

      const canonical = `v${Number(matched[1])}`;
      if (!KNOWN_VERSIONS.has(canonical)) continue; // Names no version this export has.
      if (canonical === previous) continue; // Already exactly canonical.

      updates.push({
        table: 'consent' as const,
        legacyId: consent.legacyPatientId,
        column: 'version',
        prev: previous,
        next: canonical,
      });
    }

    return { ambiguity: false, updates };
  },
};
