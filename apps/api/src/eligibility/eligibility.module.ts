import { Module } from '@nestjs/common';
import { EligibilityService } from './eligibility.service';

/** The ruleset registry and `evaluate(patient, consentEvents)` (2.0) — the latter folded into `EligibilityInput` itself (see its own doc comment). No entity — nothing here is stored; `patient.evaluation`/`ruleset_version` are the caller's to write. */
@Module({
  providers: [EligibilityService],
  exports: [EligibilityService],
})
export class EligibilityModule {}
