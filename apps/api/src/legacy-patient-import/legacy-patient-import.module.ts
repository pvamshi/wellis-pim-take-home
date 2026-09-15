import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DuplicatesModule } from '../duplicates/duplicates.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { LegacyModule } from '../legacy/legacy.module';
import { PatientModule } from '../patient/patient.module';
import { RowsModule } from '../rows/rows.module';
import { LegacyPatientImportController } from './legacy-patient-import.controller';
import { LegacyPatientImportService } from './legacy-patient-import.service';

/**
 * Legacy import, individual and bulk (2.6, 2.9): a legacy patient promoted
 * into `patient` through B1's state machine, B2's validators and engine, and
 * B1's audit writer — the same machinery B3's intake flow uses, reached here
 * from the legacy side instead.
 *
 * 2.0's architecture table names this module `legacy-import`; that name is
 * already `import/legacy-import.module.ts` (Part A's `legacy_export/` file
 * loader — an unrelated concern that happens to share a name), so this one is
 * `legacy-patient-import` instead. Noted for whoever reconciles the two.
 *
 * `ConsentEvent` needs no module of its own here: it is inserted straight
 * through `manager.insert`, the same direct-repository style `AuditWriter`
 * already uses for `audit_event`, and its owning `ConsentModule` is not
 * imported since nothing here injects a provider from it.
 */
@Module({
  imports: [
    PatientModule,
    LegacyModule,
    RowsModule,
    DuplicatesModule,
    EligibilityModule,
    AuditModule,
  ],
  controllers: [LegacyPatientImportController],
  providers: [LegacyPatientImportService],
})
export class LegacyPatientImportModule {}
