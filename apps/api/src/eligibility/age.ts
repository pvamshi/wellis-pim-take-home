/**
 * Whole years from `dateOfBirth` to `asOf`, UTC (2.7). A birthday reached on
 * `asOf` itself already counts — the month/day comparison is `<`, not `<=`,
 * so turning 18 today is 18, not 17.
 */
export function computeAgeYears(dateOfBirth: string, asOf: Date): number {
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  const asOfYear = asOf.getUTCFullYear();
  const asOfMonth = asOf.getUTCMonth() + 1;
  const asOfDay = asOf.getUTCDate();

  let age = asOfYear - birthYear;

  if (asOfMonth < birthMonth || (asOfMonth === birthMonth && asOfDay < birthDay)) {
    age -= 1;
  }

  return age;
}
