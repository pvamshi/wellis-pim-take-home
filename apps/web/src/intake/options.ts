/**
 * The intake questionnaire's fixed option lists (2.3.1) — one place both the
 * form and anything else drawing these answers (the review screen's answer
 * groups) read the same labels from.
 *
 * Values are exactly what gets stored: `weight_conditions`' values are the
 * question's own wording verbatim, because 2.5's exclusivity check
 * (`NONE_OF_THESE`) is written against the literal string `"none of these"`
 * and nothing here may drift from it. `glp1_medications`' values are short
 * codes rather than the full parenthetical — that text is spec wording for a
 * human, not a wire value, and 2.5 places no closed set on this field at all
 * (unlike `weight_conditions`), so the codes are this form's own choice.
 */

export interface Option {
  readonly value: string;
  readonly label: string;
}

/** 2.3.1 step 3's five named medications. "Other" is not in this list — see `GLP1_OTHER_VALUE`. */
export const GLP1_MEDICATION_OPTIONS: readonly Option[] = [
  { value: 'semaglutide', label: 'Semaglutide (Ozempic, Wegovy, Rybelsus)' },
  { value: 'tirzepatide', label: 'Tirzepatide (Mounjaro, Zepbound)' },
  { value: 'liraglutide', label: 'Liraglutide (Saxenda, Victoza)' },
  { value: 'dulaglutide', label: 'Dulaglutide (Trulicity)' },
  { value: 'exenatide', label: 'Exenatide (Byetta, Bydureon)' },
];

/**
 * "Other + text" (2.3.1): not a stored value on its own. Ticking this option
 * reveals a text box, and what the patient types there — not this token — is
 * what lands in `glp1_medications`.
 */
export const GLP1_OTHER_VALUE = 'other';

/** 2.3.1 step 4's seven conditions, "none of these" included — the literal string 2.5's `NONE_OF_THESE` constant checks for. */
export const WEIGHT_CONDITION_OPTIONS: readonly string[] = [
  'type 2 diabetes',
  'prediabetes',
  'high blood pressure',
  'high cholesterol',
  'sleep apnoea',
  'cardiovascular disease',
  'none of these',
];

/** 2.5's own constant, restated: the one `weight_conditions` selection that combines with nothing else. */
export const NONE_OF_THESE = 'none of these';

/** The consent text's version (2.3.1) — stored on the `consent_event` a granted step 5 writes. */
export const CONSENT_VERSION = 'dp-2026.1';

export const CONSENT_TEXT =
  'I agree to Wellis processing my health data to assess my eligibility.';

const KNOWN_GLP1_VALUES = new Set(GLP1_MEDICATION_OPTIONS.map((option) => option.value));

/**
 * Splits a stored `glp1_medications` list back into this form's own UI shape:
 * which checkboxes were ticked — the five known ones, plus `GLP1_OTHER_VALUE`
 * when anything else was stored — and what that "anything else" was, for the
 * text box "Other" reveals (2.3.1's "other + text" has no column of its
 * own: what is typed there is stored as a plain string in the same list, so
 * anything not one of the five known codes is read back as that answer).
 *
 * Several unrecognised entries are joined into the one text box this form
 * has — rare (nothing writes more than one), and lossless either way, since
 * saving the step re-splits whatever ends up in that box the same way.
 */
export function splitGlp1Medications(stored: readonly string[] | null): {
  readonly selected: string[];
  readonly otherText: string;
} {
  const selected: string[] = [];
  const other: string[] = [];

  for (const value of stored ?? []) {
    (KNOWN_GLP1_VALUES.has(value) ? selected : other).push(value);
  }

  if (other.length > 0) selected.push(GLP1_OTHER_VALUE);

  return { selected, otherText: other.join(', ') };
}

/** The inverse of `splitGlp1Medications`: this form's checkbox values, back into the flat list 2.3.1 stores. `GLP1_OTHER_VALUE` itself is never stored — only what was typed beside it. */
export function combineGlp1Medications(selected: readonly string[], otherText: string): string[] {
  const known = selected.filter((value) => value !== GLP1_OTHER_VALUE);
  const otherChecked = selected.includes(GLP1_OTHER_VALUE);
  const trimmed = otherText.trim();

  return otherChecked && trimmed !== '' ? [...known, trimmed] : known;
}
