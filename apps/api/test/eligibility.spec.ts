import { describe, expect, it } from 'vitest';
import { computeAgeYears } from '../src/eligibility/age';
import { computeBmi } from '../src/eligibility/bmi';
import type { EligibilityInput } from '../src/eligibility/eligibility-contract';
import { ACTIVE_RULESET, evaluate } from '../src/eligibility/eligibility-registry';
import { NONE_OF_THESE } from '../src/patient/validation/field-validators';

const ASOF = new Date('2026-09-15T00:00:00.000Z');

/**
 * A clear-everything baseline: 34 years old, BMI ~34.0 — comfortably above
 * E3's 30.0 ceiling, so it clears E2 (reject below 27) and E3 (flag 27–30)
 * alike — with everything else answered "no". Each test overrides only what
 * it needs.
 */
const GRANTED_CONSENT = [
  { type: 'data_processing' as const, action: 'granted' as const, at: '2020-01-01T00:00:00.000Z' },
];

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    dateOfBirth: '1992-01-01',
    heightCm: 180,
    weightKg: 110,
    glp1Current: false,
    glp1Medications: [],
    weightConditions: [NONE_OF_THESE],
    thyroidCancerHistory: false,
    pancreatitisHistory: false,
    consentEvents: GRANTED_CONSENT,
    ...overrides,
  };
}

function resultFor(ruleId: string, input: EligibilityInput) {
  const { results } = evaluate(ACTIVE_RULESET, input, ASOF);
  const result = results.find((entry) => entry.ruleId === ruleId);

  if (!result) throw new Error(`no result for ${ruleId}`);

  return result;
}

describe('B2 eligibility engine (elig-1, 2.7)', () => {
  it('is registered as ACTIVE_RULESET, and evaluate runs all six rules every time', () => {
    expect(ACTIVE_RULESET).toBe('elig-1');

    const { results, rulesetVersion } = evaluate(ACTIVE_RULESET, baseInput(), ASOF);

    expect(rulesetVersion).toBe('elig-1');
    expect(results.map((result) => result.ruleId)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
  });

  describe('age (used by E1)', () => {
    it('is reached on the birthday itself, not the day after', () => {
      expect(computeAgeYears('2008-09-15', ASOF)).toBe(18);
      expect(computeAgeYears('2008-09-16', ASOF)).toBe(17);
      expect(computeAgeYears('2008-09-14', ASOF)).toBe(18);
    });
  });

  describe('E1 — age under 18', () => {
    it('matches under 18, with the exact explanation', () => {
      const result = resultFor('E1', baseInput({ dateOfBirth: '2009-01-01' }));

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('reject');
      expect(result.explanation).toBe('rejected: age 17 at submission, under 18');
    });

    it('does not match 18 or over, with an explanation naming the age', () => {
      const result = resultFor('E1', baseInput({ dateOfBirth: '1992-01-01' }));

      expect(result.matched).toBe(false);
      expect(result.explanation).toBe('age 34 at submission, 18 or over');
    });

    it('does not match exactly on the 18th birthday', () => {
      const result = resultFor('E1', baseInput({ dateOfBirth: '2008-09-15' }));

      expect(result.matched).toBe(false);
    });

    it('matches the day before the 18th birthday', () => {
      const result = resultFor('E1', baseInput({ dateOfBirth: '2008-09-16' }));

      expect(result.matched).toBe(true);
    });
  });

  describe('BMI rounding (used by E2/E3)', () => {
    it('26.96 rounds to 27.0, not down to 27.0-adjacent-but-rejected 26.9', () => {
      // weight/height chosen so the raw BMI is 26.96 exactly.
      const heightCm = 100;
      const weightKg = 26.96;

      expect(computeBmi(heightCm, weightKg)).toBe(27.0);
    });

    it('a submission whose raw BMI is 26.96 clears E2 rather than rejecting (2.7: compared rounded)', () => {
      const result = resultFor('E2', baseInput({ heightCm: 100, weightKg: 26.96 }));

      expect(result.matched).toBe(false);
      expect(result.explanation).toBe('BMI 27.0, 27 or above');
    });
  });

  describe('E2 — BMI below 27.0', () => {
    it('matches below 27, with the exact explanation', () => {
      const result = resultFor('E2', baseInput({ heightCm: 200, weightKg: 100 })); // BMI 25.0

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('reject');
      expect(result.explanation).toBe('rejected: BMI 25.0, below 27');
    });

    it('does not match at exactly 27.0', () => {
      const result = resultFor('E2', baseInput({ heightCm: 100, weightKg: 27 })); // BMI 27.0

      expect(result.matched).toBe(false);
    });

    it('matches just under 27.0', () => {
      const result = resultFor('E2', baseInput({ heightCm: 100, weightKg: 26.9 })); // BMI 26.9

      expect(result.matched).toBe(true);
    });

    it('rejects a missing height or a missing weight as BMI not recorded, with the exact explanation', () => {
      for (const input of [baseInput({ heightCm: null }), baseInput({ weightKg: null })]) {
        const result = resultFor('E2', input);

        expect(result.matched).toBe(true);
        expect(result.outcome).toBe('reject');
        expect(result.explanation).toBe(
          'rejected: BMI not recorded (legacy), height or weight missing',
        );
      }
    });
  });

  describe('E3 — BMI 27.0-30.0 with no weight-related condition', () => {
    it('matches at the low boundary (27.0) with none selected', () => {
      const result = resultFor(
        'E3',
        baseInput({ heightCm: 100, weightKg: 27, weightConditions: [NONE_OF_THESE] }),
      );

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('flag');
      expect(result.explanation).toBe('flagged: BMI 27.0 with no weight-related condition');
    });

    it('matches at the high boundary (30.0)', () => {
      const result = resultFor(
        'E3',
        baseInput({ heightCm: 100, weightKg: 30, weightConditions: [NONE_OF_THESE] }),
      );

      expect(result.matched).toBe(true);
    });

    it('does not match just under 27.0 or just over 30.0', () => {
      expect(resultFor('E3', baseInput({ heightCm: 100, weightKg: 26.9 })).matched).toBe(false);
      expect(resultFor('E3', baseInput({ heightCm: 100, weightKg: 30.1 })).matched).toBe(false);
    });

    it('does not match in range with a real condition selected', () => {
      const result = resultFor(
        'E3',
        baseInput({ heightCm: 100, weightKg: 28, weightConditions: ['high blood pressure'] }),
      );

      expect(result.matched).toBe(false);
      expect(result.explanation).toBe('BMI 28.0 with a weight-related condition');
    });

    it('a null weight_conditions in range flags as not recorded (legacy), not as clear', () => {
      const result = resultFor(
        'E3',
        baseInput({ heightCm: 100, weightKg: 28, weightConditions: null }),
      );

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('flag');
      expect(result.explanation).toBe('flagged: weight-related conditions not recorded (legacy)');
    });

    it('a missing BMI does not match, even with weight_conditions unrecorded', () => {
      const result = resultFor('E3', baseInput({ heightCm: null, weightConditions: null }));

      expect(result.matched).toBe(false);
    });

    it('a null weight_conditions out of range still does not match — BMI already decides it', () => {
      const result = resultFor(
        'E3',
        baseInput({ heightCm: 100, weightKg: 20, weightConditions: null }),
      );

      expect(result.matched).toBe(false);
    });
  });

  describe('E4 — currently using a GLP-1 medication', () => {
    it('matches yes, naming the medications on record', () => {
      const result = resultFor(
        'E4',
        baseInput({ glp1Current: true, glp1Medications: ['semaglutide'] }),
      );

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('flag');
      expect(result.explanation).toBe('flagged: currently using a GLP-1 medication (semaglutide)');
    });

    it('matches yes even with no medications on record', () => {
      const result = resultFor('E4', baseInput({ glp1Current: true, glp1Medications: [] }));

      expect(result.matched).toBe(true);
      expect(result.explanation).toBe('flagged: currently using a GLP-1 medication');
    });

    it('does not match no', () => {
      const result = resultFor('E4', baseInput({ glp1Current: false, glp1Medications: [] }));

      expect(result.matched).toBe(false);
      expect(result.explanation).toBe('not currently using a GLP-1 medication');
    });

    it('a null glp1_current flags as not recorded (legacy)', () => {
      const result = resultFor('E4', baseInput({ glp1Current: null, glp1Medications: null }));

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('flag');
      expect(result.explanation).toBe('flagged: GLP-1 use not recorded (legacy)');
    });
  });

  describe('E5 — self-reported thyroid cancer or pancreatitis history', () => {
    it('matches thyroid cancer alone, naming it', () => {
      const result = resultFor(
        'E5',
        baseInput({ thyroidCancerHistory: true, pancreatitisHistory: false }),
      );

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('flag');
      expect(result.explanation).toBe('flagged: self-reported history of thyroid cancer');
    });

    it("matches pancreatitis alone, with 2.7's exact example wording", () => {
      const result = resultFor(
        'E5',
        baseInput({ thyroidCancerHistory: false, pancreatitisHistory: true }),
      );

      expect(result.matched).toBe(true);
      expect(result.explanation).toBe('flagged: self-reported history of pancreatitis');
    });

    it('names both when both are true', () => {
      const result = resultFor(
        'E5',
        baseInput({ thyroidCancerHistory: true, pancreatitisHistory: true }),
      );

      expect(result.explanation).toBe(
        'flagged: self-reported history of thyroid cancer and pancreatitis',
      );
    });

    it('does not match two definite noes', () => {
      const result = resultFor(
        'E5',
        baseInput({ thyroidCancerHistory: false, pancreatitisHistory: false }),
      );

      expect(result.matched).toBe(false);
    });

    it('a null answer a rule needs flags as not recorded (legacy), even with the other a definite no', () => {
      const result = resultFor(
        'E5',
        baseInput({ thyroidCancerHistory: null, pancreatitisHistory: false }),
      );

      expect(result.matched).toBe(true);
      expect(result.explanation).toBe(
        'flagged: thyroid cancer / pancreatitis history not recorded (legacy)',
      );
    });

    it('a definite yes on one wins over the other still being unrecorded', () => {
      const result = resultFor(
        'E5',
        baseInput({ thyroidCancerHistory: true, pancreatitisHistory: null }),
      );

      expect(result.matched).toBe(true);
      expect(result.explanation).toBe('flagged: self-reported history of thyroid cancer');
    });
  });

  describe('E6 — latest data_processing consent event is revoked', () => {
    it('matches a revoked latest event, with the exact explanation', () => {
      const result = resultFor(
        'E6',
        baseInput({
          consentEvents: [
            { type: 'data_processing', action: 'granted', at: '2024-01-01T00:00:00.000Z' },
            { type: 'data_processing', action: 'revoked', at: '2024-03-02T00:00:00.000Z' },
          ],
        }),
      );

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('reject');
      expect(result.explanation).toBe('rejected: data processing consent revoked on 2024-03-02');
    });

    it('does not match when the latest event is granted, even after an earlier revoke', () => {
      const result = resultFor(
        'E6',
        baseInput({
          consentEvents: [
            { type: 'data_processing', action: 'revoked', at: '2024-01-01T00:00:00.000Z' },
            { type: 'data_processing', action: 'granted', at: '2024-03-02T00:00:00.000Z' },
          ],
        }),
      );

      expect(result.matched).toBe(false);
      expect(result.explanation).toBe('data processing consent granted on 2024-03-02, not revoked');
    });

    it('goes by `at`, not by array order', () => {
      const result = resultFor(
        'E6',
        baseInput({
          consentEvents: [
            { type: 'data_processing', action: 'granted', at: '2024-03-02T00:00:00.000Z' },
            { type: 'data_processing', action: 'revoked', at: '2024-01-01T00:00:00.000Z' },
          ],
        }),
      );

      expect(result.matched).toBe(false);
    });

    it('no consent event at all flags as not recorded (legacy), not as a reject', () => {
      const result = resultFor('E6', baseInput({ consentEvents: [] }));

      expect(result.matched).toBe(true);
      expect(result.outcome).toBe('flag');
      expect(result.explanation).toBe('flagged: data processing consent not recorded (legacy)');
    });
  });

  describe('precedence: reject > flag > clear', () => {
    it('clears when nothing matches', () => {
      const { outcome, explanation } = evaluate(ACTIVE_RULESET, baseInput(), ASOF);

      expect(outcome).toBe('auto_cleared');
      expect(explanation).toBe('cleared: no rule matched, for doctor review');
    });

    it('flags when a flag rule matches and no reject rule does', () => {
      const { outcome } = evaluate(ACTIVE_RULESET, baseInput({ glp1Current: true }), ASOF);

      expect(outcome).toBe('auto_flagged');
    });

    it('rejects when a reject rule matches, even alongside a matched flag rule', () => {
      // Under 18 (E1, reject) and currently using a GLP-1 (E4, flag) together.
      const { outcome, results } = evaluate(
        ACTIVE_RULESET,
        baseInput({ dateOfBirth: '2010-01-01', glp1Current: true }),
        ASOF,
      );

      expect(outcome).toBe('auto_rejected');
      expect(results.find((r) => r.ruleId === 'E1')?.matched).toBe(true);
      expect(results.find((r) => r.ruleId === 'E4')?.matched).toBe(true);
    });

    it('a legacy import (medication/health null, no consent event) is flagged or rejected, never cleared', () => {
      const legacyInput = baseInput({
        glp1Current: null,
        glp1Medications: null,
        weightConditions: null,
        thyroidCancerHistory: null,
        pancreatitisHistory: null,
        consentEvents: [],
      });

      const { outcome } = evaluate(ACTIVE_RULESET, legacyInput, ASOF);

      expect(outcome).toBe('auto_flagged');
    });

    it('a legacy import whose latest consent event is revoked rejects, even though every other field is unanswered', () => {
      const legacyInput = baseInput({
        glp1Current: null,
        glp1Medications: null,
        weightConditions: null,
        thyroidCancerHistory: null,
        pancreatitisHistory: null,
        consentEvents: [
          { type: 'data_processing', action: 'revoked', at: '2024-03-02T00:00:00.000Z' },
        ],
      });

      const { outcome, results } = evaluate(ACTIVE_RULESET, legacyInput, ASOF);

      expect(outcome).toBe('auto_rejected');
      expect(results.find((r) => r.ruleId === 'E6')?.outcome).toBe('reject');
    });

    it('a legacy import without height or weight is auto_rejected, with no BMI to store', () => {
      const { outcome, bmi } = evaluate(
        ACTIVE_RULESET,
        baseInput({ heightCm: null, weightKg: null }),
        ASOF,
      );

      expect(outcome).toBe('auto_rejected');
      expect(bmi).toBeNull();
    });
  });

  it('throws for an unregistered ruleset version', () => {
    expect(() => evaluate('elig-99', baseInput(), ASOF)).toThrow(/elig-99/);
  });
});
