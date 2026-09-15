import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { EligibilityConsentEvent } from '../eligibility/eligibility-contract';
import { ConsentEvent } from './consent-event.entity';

/**
 * The one read of `consent_event` shared by B3's submit/review flow and B4's
 * import: a patient's whole history (2.1.2), and the two small things every
 * caller needs out of it — whether the latest `data_processing` event is
 * granted, and the shape `EligibilityInput.consentEvents` wants (2.7).
 *
 * No write here: step 5 (2.3.1) and B4's import each insert their own event
 * with fields only they know (`origin`, `legacyRowId`), so there is nothing a
 * shared "grant" method would save either of them.
 */
@Injectable()
export class ConsentEventsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Every event on record for one patient, oldest first — `manager`, when given, reads inside a caller's own transaction. */
  async listFor(patientId: string, manager?: EntityManager): Promise<ConsentEvent[]> {
    return (manager ?? this.dataSource.manager)
      .getRepository(ConsentEvent)
      .find({ where: { patientId }, order: { at: 'ASC' } });
  }

  /**
   * Whether the latest `data_processing` event, by `at`, is `granted` (E6,
   * 2.7) — false both when it is `revoked` and when there is no event at all,
   * which callers that need to tell those two apart (review's "not recorded"
   * marking) check separately with `hasDataProcessingRecord`.
   */
  hasGrantedDataProcessing(events: readonly ConsentEvent[]): boolean {
    const latest = latestDataProcessing(events);

    return latest !== null && latest.action === 'granted';
  }

  /** Whether any `data_processing` event exists at all — E6's own "not recorded (legacy)" case. */
  hasDataProcessingRecord(events: readonly ConsentEvent[]): boolean {
    return latestDataProcessing(events) !== null;
  }

  /** `EligibilityInput.consentEvents` (2.7), reduced from the stored rows. */
  toEligibilityEvents(events: readonly ConsentEvent[]): EligibilityConsentEvent[] {
    return events.map((event) => ({ type: event.type, action: event.action, at: event.at }));
  }
}

function latestDataProcessing(events: readonly ConsentEvent[]): ConsentEvent | null {
  const dataProcessing = events.filter((event) => event.type === 'data_processing');

  if (dataProcessing.length === 0) {
    return null;
  }

  return dataProcessing.reduce((latest, event) => (event.at > latest.at ? event : latest));
}
