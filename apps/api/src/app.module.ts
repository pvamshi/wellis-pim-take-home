import { Module } from '@nestjs/common';
import { ApplyRulesModule } from './apply-rules/apply-rules.module';
import { ApproveModule } from './approve/approve.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { AppConfigModule } from './config/app-config.module';
import { DeclineModule } from './decline/decline.module';
import { DuplicatesModule } from './duplicates/duplicates.module';
import { HealthModule } from './health/health.module';
import { LegacyImportModule } from './import/legacy-import.module';
import { LegacyModule } from './legacy/legacy.module';
import { RowsModule } from './rows/rows.module';
import { RowsListModule } from './rows-list/rows-list.module';
import { RowActionsModule } from './row-actions/row-actions.module';
import { RowDetailModule } from './row-detail/row-detail.module';
import { RuleDetailModule } from './rule-detail/rule-detail.module';
import { RulesListModule } from './rules-list/rules-list.module';
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [
    AppConfigModule,
    HealthModule,
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
    RowsModule,
    RowsListModule,
    RowDetailModule,
    RowActionsModule,
  ],
})
export class AppModule {}
