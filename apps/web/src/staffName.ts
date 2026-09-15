/**
 * The staff member's own name, entered once and kept in `localStorage` (2.4:
 * "Reviewer is a name entered once, kept in localStorage, sent as `actor`").
 *
 * One key shared by the review screen and the rows screen's import (2.6),
 * rather than two separate prompts for the same person — 2.4 names where the
 * reviewer's name lives; 2.6 requires an `actor` on every import but names no
 * UI for it, so this reuses the one place a staff name is already collected
 * (a decision made in this codebase's own style, not stated by either
 * section).
 */
const STAFF_NAME_KEY = 'wellis.staffName';

/** Whatever name was last entered, or the empty string when none has been. Never throws — a private window or blocked storage reads as "no name yet". */
export function getStoredStaffName(): string {
  try {
    return localStorage.getItem(STAFF_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Stores the name for next time. Silently does nothing when storage is unavailable — the name still works for the rest of this visit, held in the caller's own state. */
export function setStoredStaffName(name: string): void {
  try {
    localStorage.setItem(STAFF_NAME_KEY, name);
  } catch {
    // Nothing to recover: the caller's in-memory state is still correct for this visit.
  }
}
