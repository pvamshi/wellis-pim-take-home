const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a string that is both `YYYY-MM-DD`-shaped and a real calendar
 * date — `2023-02-30` is the shape but not the date, and `new Date(...)`
 * would silently roll it into March rather than reject it, so this checks
 * the day against the actual length of that month (leap years included via
 * `Date.UTC`, never guessed at with a fixed 28/29 table).
 */
export function isRealCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    return false;
  }

  // Day 0 of the month after `month` (1-based) is the last day of `month` itself.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return day >= 1 && day <= daysInMonth;
}

/** `asOf` as `YYYY-MM-DD`, UTC — what "today" means everywhere a date field is compared against it. */
export function isoDate(asOf: Date): string {
  return asOf.toISOString().slice(0, 10);
}
