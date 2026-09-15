/**
 * The draft being filled in, remembered across a reload (2.3: "Draft id in
 * the URL and localStorage; resumable"). The URL is the form's own source of
 * truth while it is open — every step route already carries the id —
 * `localStorage` is only what lets a patient who closes the tab find their
 * way back to `/intake/:id/1` from a bare `/intake`.
 */
const DRAFT_ID_KEY = 'wellis.intake.draftId';

/** The last draft id remembered, or null when there is none, or storage is unavailable. */
export function getStoredDraftId(): string | null {
  try {
    return localStorage.getItem(DRAFT_ID_KEY);
  } catch {
    return null;
  }
}

export function setStoredDraftId(id: string): void {
  try {
    localStorage.setItem(DRAFT_ID_KEY, id);
  } catch {
    // Nothing to recover: the id still lives in the URL for the rest of this visit.
  }
}

/** Called once a draft reaches `done` (submitted) — nothing left on this browser to resume. */
export function clearStoredDraftId(): void {
  try {
    localStorage.removeItem(DRAFT_ID_KEY);
  } catch {
    // Nothing to recover: an id that outlives its draft only ever redirects straight to `/intake/:id/done`.
  }
}
