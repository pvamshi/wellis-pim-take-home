import { Module } from '@nestjs/common';
import { ApplyRulesModule } from './apply-rules/apply-rules.module';
import { ApproveModule } from './approve/approve.module';
import { AppConfigModule } from './config/app-config.module';
import { DeclineModule } from './decline/decline.module';
import { DuplicatesModule } from './duplicates/duplicates.module';
import { HealthModule } from './health/health.module';
import { LegacyImportModule } from './import/legacy-import.module';
import { LegacyModule } from './legacy/legacy.module';
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [
    AppConfigModule,
    HealthModule,
    LegacyModule,
    LegacyImportModule,
    RulesModule,
    ApplyRulesModule,
    ApproveModule,
    DeclineModule,
    DuplicatesModule,
  ],
})
export class AppModule {}
