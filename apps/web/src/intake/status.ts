import type { IntakeStatus } from '../api/types';

/** How every `intake_status` (2.2) reads and colours on the review screen. Shared by the queue's status column and the detail's own heading. */
export const STATUS_LABELS: Record<IntakeStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  auto_cleared: 'Auto-cleared',
  auto_flagged: 'Auto-flagged',
  auto_rejected: 'Auto-rejected',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const STATUS_COLORS: Record<IntakeStatus, string> = {
  draft: 'gray',
  submitted: 'gray',
  auto_cleared: 'green',
  auto_flagged: 'yellow',
  auto_rejected: 'orange',
  in_review: 'blue',
  approved: 'teal',
  rejected: 'red',
};
