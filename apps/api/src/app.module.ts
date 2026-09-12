import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { HealthModule } from './health/health.module';
import { LegacyModule } from './legacy/legacy.module';

@Module({
  imports: [AppConfigModule, HealthModule, LegacyModule],
})
export class AppModule {}
