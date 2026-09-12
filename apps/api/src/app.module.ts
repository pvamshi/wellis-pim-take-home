import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { HealthModule } from './health/health.module';
import { LegacyImportModule } from './import/legacy-import.module';
import { LegacyModule } from './legacy/legacy.module';
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [AppConfigModule, HealthModule, LegacyModule, LegacyImportModule, RulesModule],
})
export class AppModule {}
