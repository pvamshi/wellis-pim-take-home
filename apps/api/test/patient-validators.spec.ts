import { describe, expect, it } from 'vitest';
import {
  NONE_OF_THESE,
  normalizeEmail,
  validateAccountStatus,
  validateAlcoholUnitsWeek,
  validateBsn,
  validateDateOfBirth,
  validateEmail,
  validateFullName,
  validateHeightCm,
  validateLegacyWeightUnit,
  validatePhone,
  validateSex,
  validateSignupDate,
  validateWeightConditions,
  validateWeightKg,
} from '../src/patient/validation/field-validators';
import {
  validateFullIntakeSubmission,
  validateIntakeStep,
} from '../src/patient/validation/intake-validators';
import { validateLegacyImportPatient } from '../src/patient/validation/legacy-import-validators';

const TODAY = new Date('2026-09-15T00:00:00.000Z');

/** A full, valid step-1..5 body — every test starts from this and overrides just the field under test. */
function validSubmission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: 'Ada Lovelace',
    email: 'ada@example.com',
    date_of_birth: '1990-06-15',
    height_cm: 170,
    weight_kg: 70,
    glp1_current: false,
    glp1_medications: [],
    other_medications: null,
    weight_conditions: [NONE_OF_THESE],
    thyroid_cancer_history: false,
    pancreatitis_history: false,
    other_conditions: null,
    alcohol_units_week: 5,
    consent_data_processing: true,
    ...overrides,
  };
}

describe('B2 backend validators (2.5)', () => {
  describe('full_name', () => {
    it('accepts a plain name', () => {
      expect(validateFullName('Ada Lovelace')).toBeNull();
    });

    it('accepts the 2 and 120 character boundaries', () => {
      expect(validateFullName('Al')).toBeNull();
      expect(validateFullName('A'.repeat(119) + 'z')).toBeNull();
    });

    it('rejects 1 character and 121 characters', () => {
      expect(validateFullName('A')?.reason).toMatch(/2–120/);
      expect(validateFullName('A'.repeat(121))?.reason).toMatch(/2–120/);
    });

    it('trims before measuring length', () => {
      expect(validateFullName('  Al  ')).toBeNull();
      expect(validateFullName(' A ')?.reason).toMatch(/2–120/);
    });

    it('rejects a name with no letter', () => {
      expect(validateFullName("''--")?.reason).toMatch(/letter/);
    });

    it('rejects a digit', () => {
      expect(validateFullName('Ada 2nd')?.reason).toMatch(/digit/);
    });

    it('rejects an "@"', () => {
      expect(validateFullName('Ada@Lovelace')?.reason).toMatch(/@/);
    });

    it('rejects a non-string', () => {
      expect(validateFullName(42)?.field).toBe('full_name');
    });
  });

  describe('email', () => {
    it('accepts a plain address', () => {
      expect(validateEmail('ada@example.com')).toBeNull();
    });

    it('trims before checking', () => {
      expect(validateEmail('  ada@example.com  ')).toBeNull();
    });

    it('rejects internal whitespace', () => {
      expect(validateEmail('a da@example.com')?.reason).toMatch(/whitespace/);
    });

    it('accepts exactly 254 characters and rejects 255', () => {
      const local255 = 'a'.repeat(255 - '@example.com'.length);
      const local254 = 'a'.repeat(254 - '@example.com'.length);

      expect(validateEmail(`${local254}@example.com`)).toBeNull();
      expect(validateEmail(`${local255}@example.com`)?.reason).toMatch(/254/);
    });

    it('rejects zero or two "@"', () => {
      expect(validateEmail('adaexample.com')?.reason).toMatch(/@/);
      expect(validateEmail('a@da@example.com')?.reason).toMatch(/@/);
    });

    it('rejects a domain with no "."', () => {
      expect(validateEmail('ada@examplecom')?.reason).toMatch(/\./);
    });

    it('normalizes to trimmed lowercase', () => {
      expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    });
  });

  describe('date_of_birth', () => {
    it('accepts a real date', () => {
      expect(validateDateOfBirth('1990-06-15', TODAY)).toBeNull();
    });

    it('accepts today and the 1900-01-01 boundary', () => {
      expect(validateDateOfBirth('2026-09-15', TODAY)).toBeNull();
      expect(validateDateOfBirth('1900-01-01', TODAY)).toBeNull();
    });

    it('rejects tomorrow and one day before 1900-01-01', () => {
      expect(validateDateOfBirth('2026-09-16', TODAY)?.reason).toMatch(/today/);
      expect(validateDateOfBirth('1899-12-31', TODAY)?.reason).toMatch(/1900/);
    });

    it('rejects a calendar date that does not exist', () => {
      expect(validateDateOfBirth('2023-02-30', TODAY)?.reason).toMatch(/real calendar date/);
      expect(validateDateOfBirth('2023-13-01', TODAY)?.reason).toMatch(/real calendar date/);
    });

    it('accepts 29 February on a leap year and rejects it on a non-leap year', () => {
      expect(validateDateOfBirth('2000-02-29', TODAY)).toBeNull();
      expect(validateDateOfBirth('2001-02-29', TODAY)?.reason).toMatch(/real calendar date/);
    });

    it('rejects the wrong shape', () => {
      expect(validateDateOfBirth('15-06-1990', TODAY)?.reason).toMatch(/real calendar date/);
    });
  });

  describe('height_cm', () => {
    it('accepts the 100 and 250 boundaries', () => {
      expect(validateHeightCm(100)).toBeNull();
      expect(validateHeightCm(250)).toBeNull();
    });

    it('rejects just outside either boundary', () => {
      expect(validateHeightCm(99.9)?.reason).toMatch(/100 and 250/);
      expect(validateHeightCm(250.1)?.reason).toMatch(/100 and 250/);
    });

    it('rejects a non-number', () => {
      expect(validateHeightCm('170')?.field).toBe('height_cm');
    });
  });

  describe('weight_kg', () => {
    it('accepts the 30 and 400 boundaries', () => {
      expect(validateWeightKg(30)).toBeNull();
      expect(validateWeightKg(400)).toBeNull();
    });

    it('rejects just outside either boundary', () => {
      expect(validateWeightKg(29.9)?.reason).toMatch(/30 and 400/);
      expect(validateWeightKg(400.1)?.reason).toMatch(/30 and 400/);
    });
  });

  describe('weight_conditions', () => {
    it('accepts one real condition', () => {
      expect(validateWeightConditions(['type 2 diabetes'])).toBeNull();
    });

    it('accepts "none of these" alone', () => {
      expect(validateWeightConditions([NONE_OF_THESE])).toBeNull();
    });

    it('rejects an empty selection', () => {
      expect(validateWeightConditions([])?.reason).toMatch(/at least one/);
    });

    it('rejects "none of these" combined with another selection', () => {
      expect(validateWeightConditions([NONE_OF_THESE, 'high blood pressure'])?.reason).toMatch(
        /cannot be combined/,
      );
    });

    it('accepts more than one real condition together', () => {
      expect(validateWeightConditions(['high blood pressure', 'high cholesterol'])).toBeNull();
    });
  });

  describe('alcohol_units_week (optional)', () => {
    it('accepts absent', () => {
      expect(validateAlcoholUnitsWeek(undefined)).toBeNull();
      expect(validateAlcoholUnitsWeek(null)).toBeNull();
    });

    it('accepts the 0 and 200 boundaries', () => {
      expect(validateAlcoholUnitsWeek(0)).toBeNull();
      expect(validateAlcoholUnitsWeek(200)).toBeNull();
    });

    it('rejects just outside either boundary', () => {
      expect(validateAlcoholUnitsWeek(-1)?.reason).toMatch(/0 and 200/);
      expect(validateAlcoholUnitsWeek(201)?.reason).toMatch(/0 and 200/);
    });

    it('rejects a non-whole number', () => {
      expect(validateAlcoholUnitsWeek(3.5)?.reason).toMatch(/whole number/);
    });
  });

  describe('sex (legacy)', () => {
    it('accepts null, M and F', () => {
      expect(validateSex(null)).toBeNull();
      expect(validateSex('M')).toBeNull();
      expect(validateSex('F')).toBeNull();
    });

    it('rejects anything else, case included', () => {
      expect(validateSex('m')?.reason).toMatch(/M.*F/);
      expect(validateSex('X')).not.toBeNull();
    });
  });

  describe('bsn (legacy)', () => {
    it('accepts null', () => {
      expect(validateBsn(null)).toBeNull();
    });

    it('accepts a 9-digit number that passes the eleven-proef', () => {
      expect(validateBsn('111222333')).toBeNull();
      expect(validateBsn('123456782')).toBeNull();
    });

    it('rejects a 9-digit number that fails the checksum', () => {
      expect(validateBsn('123456789')?.reason).toMatch(/eleven-proef/);
    });

    it('rejects the wrong length', () => {
      expect(validateBsn('12345678')?.reason).toMatch(/9 digits/);
      expect(validateBsn('1234567890')?.reason).toMatch(/9 digits/);
    });

    it('rejects non-digits', () => {
      expect(validateBsn('12345678a')?.reason).toMatch(/9 digits/);
    });
  });

  describe('phone (legacy)', () => {
    it('accepts null', () => {
      expect(validatePhone(null)).toBeNull();
    });

    it('accepts the 8 and 15 digit boundaries', () => {
      expect(validatePhone('+12345678')).toBeNull();
      expect(validatePhone('+123456789012345')).toBeNull();
    });

    it('rejects 7 and 16 digits', () => {
      expect(validatePhone('+1234567')?.reason).toMatch(/E\.164/);
      expect(validatePhone('+1234567890123456')?.reason).toMatch(/E\.164/);
    });

    it('rejects a missing "+"', () => {
      expect(validatePhone('12345678')?.reason).toMatch(/E\.164/);
    });
  });

  describe('account_status (legacy)', () => {
    it('accepts each of the four values', () => {
      for (const status of ['active', 'paused', 'churned', 'prospect']) {
        expect(validateAccountStatus(status)).toBeNull();
      }
    });

    it('rejects anything else', () => {
      expect(validateAccountStatus('trial')).not.toBeNull();
    });
  });

  describe('signup_date (legacy)', () => {
    it('accepts null and today', () => {
      expect(validateSignupDate(null, TODAY)).toBeNull();
      expect(validateSignupDate('2026-09-15', TODAY)).toBeNull();
    });

    it('rejects tomorrow', () => {
      expect(validateSignupDate('2026-09-16', TODAY)?.reason).toMatch(/today/);
    });

    it('rejects an unreal date', () => {
      expect(validateSignupDate('2026-02-30', TODAY)?.reason).toMatch(/real calendar date/);
    });
  });

  describe('weight (legacy: weight_unit is kg)', () => {
    it('accepts "kg"', () => {
      expect(validateLegacyWeightUnit('kg')).toBeNull();
    });

    it('accepts an empty unit, because kg is the default (D6)', () => {
      expect(validateLegacyWeightUnit(null)).toBeNull();
      expect(validateLegacyWeightUnit('')).toBeNull();
      expect(validateLegacyWeightUnit('   ')).toBeNull();
    });

    it('rejects lb and anything else, and names the field "weight"', () => {
      const error = validateLegacyWeightUnit('lb');

      expect(error?.field).toBe('weight');
      expect(error?.reason).toMatch(/kg/);
    });
  });

  describe("validateIntakeStep — only that step's fields", () => {
    it('validates step 1 alone, ignoring an invalid step 2 field in the same body', () => {
      const body = validSubmission({ full_name: '', height_cm: 1 });

      expect(validateIntakeStep(1, body)).toEqual([
        expect.objectContaining({ field: 'full_name' }),
      ]);
    });

    it('collects every failing field in one step, not just the first', () => {
      const body = validSubmission({ full_name: '', email: 'not-an-email' });
      const errors = validateIntakeStep(1, body);

      expect(errors.map((error) => error.field).sort()).toEqual(['email', 'full_name']);
    });

    it('passes a fully valid step', () => {
      expect(validateIntakeStep(1, validSubmission())).toEqual([]);
      expect(validateIntakeStep(2, validSubmission())).toEqual([]);
      expect(validateIntakeStep(3, validSubmission())).toEqual([]);
      expect(validateIntakeStep(4, validSubmission())).toEqual([]);
      expect(validateIntakeStep(5, validSubmission())).toEqual([]);
    });

    it('step 3: requires glp1_medications when glp1_current is yes', () => {
      const body = validSubmission({ glp1_current: true, glp1_medications: [] });

      expect(validateIntakeStep(3, body)).toEqual([
        expect.objectContaining({ field: 'glp1_medications' }),
      ]);
    });

    it('step 3: requires glp1_medications empty when glp1_current is no', () => {
      const body = validSubmission({ glp1_current: false, glp1_medications: ['semaglutide'] });

      expect(validateIntakeStep(3, body)).toEqual([
        expect.objectContaining({ field: 'glp1_medications' }),
      ]);
    });

    it('step 3/4: a yes/no question left unanswered fails, never reads as no', () => {
      const body = validSubmission({ glp1_current: undefined, glp1_medications: undefined });

      expect(validateIntakeStep(3, body)).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'glp1_current' })]),
      );
    });

    it('treats a malformed body as every required field missing, rather than throwing', () => {
      expect(() => validateIntakeStep(1, 'not an object')).not.toThrow();
      expect(
        validateIntakeStep(1, null)
          .map((error) => error.field)
          .sort(),
      ).toEqual(['date_of_birth', 'email', 'full_name']);
    });
  });

  describe('validateFullIntakeSubmission — every step together', () => {
    it('passes a fully valid submission', () => {
      expect(validateFullIntakeSubmission(validSubmission(), TODAY)).toEqual([]);
    });

    it('collects errors across every step at once', () => {
      const body = validSubmission({
        full_name: '',
        height_cm: 1,
        weight_conditions: [],
        consent_data_processing: false,
      });

      const fields = validateFullIntakeSubmission(body, TODAY)
        .map((error) => error.field)
        .sort();

      expect(fields).toEqual([
        'consent_data_processing',
        'full_name',
        'height_cm',
        'weight_conditions',
      ]);
    });
  });

  describe('validateLegacyImportPatient — identity and body only (2.5, 2.6)', () => {
    function validLegacyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        full_name: 'Ada Lovelace',
        email: 'ada@example.com',
        date_of_birth: '1965-03-02',
        height_cm: 165,
        weight_kg: 68,
        weight_unit: 'kg',
        sex: 'F',
        bsn: '111222333',
        phone: '+31612345678',
        account_status: 'active',
        signup_date: '2020-01-01',
        ...overrides,
      };
    }

    it('passes a fully valid row', () => {
      expect(validateLegacyImportPatient(validLegacyRow())).toEqual([]);
    });

    it('passes with every legacy-nullable field null', () => {
      expect(
        validateLegacyImportPatient(
          validLegacyRow({ sex: null, bsn: null, phone: null, signup_date: null }),
        ),
      ).toEqual([]);
    });

    it('passes with height and weight missing — E2 rejects those, validation does not (2.5, 2.7)', () => {
      expect(
        validateLegacyImportPatient(
          validLegacyRow({ height_cm: null, weight_kg: null, weight_unit: null }),
        ),
      ).toEqual([]);
    });

    it('applies the identity and body rules exactly as intake does', () => {
      const errors = validateLegacyImportPatient(validLegacyRow({ full_name: '9', height_cm: 1 }));

      expect(errors.map((error) => error.field).sort()).toEqual(['full_name', 'height_cm']);
    });

    it('fails the row when weight_unit is not kg', () => {
      const errors = validateLegacyImportPatient(validLegacyRow({ weight_unit: 'lb' }));

      expect(errors).toEqual([expect.objectContaining({ field: 'weight' })]);
    });

    it('never asks for medication or health answers — there is no such field to fail', () => {
      // 2.6: glp1_current, weight_conditions, thyroid_cancer_history and
      // pancreatitis_history are always mapped to null on import, and this
      // validator never reads any of the four.
      expect(validateLegacyImportPatient(validLegacyRow())).toEqual([]);
    });
  });
});
