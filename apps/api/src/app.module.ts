import { Module } from '@nestjs/common';
import { ApplyRulesModule } from './apply-rules/apply-rules.module';
import { ApproveModule } from './approve/approve.module';
import { AuditModule } from './audit/audit.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { AppConfigModule } from './config/app-config.module';
import { ConsentModule } from './consent/consent.module';
import { DeclineModule } from './decline/decline.module';
import { DuplicateActionsModule } from './duplicate-actions/duplicate-actions.module';
import { DuplicateDetailModule } from './duplicate-detail/duplicate-detail.module';
import { DuplicatesListModule } from './duplicates-list/duplicates-list.module';
import { DuplicatesModule } from './duplicates/duplicates.module';
import { EligibilityModule } from './eligibility/eligibility.module';
import { HealthModule } from './health/health.module';
import { IntakeModule } from './intake/intake.module';
import { LegacyImportModule } from './import/legacy-import.module';
import { LegacyModule } from './legacy/legacy.module';
import { LegacyPatientImportModule } from './legacy-patient-import/legacy-patient-import.module';
import { PatientModule } from './patient/patient.module';
import { ReviewModule } from './review/review.module';
import { RowsModule } from './rows/rows.module';
import { RowsListModule } from './rows-list/rows-list.module';
import { RowActionsModule } from './row-actions/row-actions.module';
import { RowDetailModule } from './row-detail/row-detail.module';
import { RowEditModule } from './row-edit/row-edit.module';
import { RuleDetailModule } from './rule-detail/rule-detail.module';
import { RulesListModule } from './rules-list/rules-list.module';
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [
    AppConfigModule,
    HealthModule,
    AuditModule,
    PatientModule,
    ConsentModule,
    EligibilityModule,
    LegacyModule,
    LegacyImportModule,
    RulesModule,
    CatalogueModule,
    ApplyRulesModule,
    ApproveModule,
    DeclineModule,
    RulesListModule,
    RuleDetailModule,
    DuplicatesModule,
    DuplicatesListModule,
    DuplicateDetailModule,
    DuplicateActionsModule,
    RowsModule,
    RowsListModule,
    RowDetailModule,
    RowActionsModule,
    RowEditModule,
    IntakeModule,
    ReviewModule,
    LegacyPatientImportModule,
  ],
})
export class AppModule {}
