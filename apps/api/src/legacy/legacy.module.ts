import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LegacyConsent } from './legacy-consent.entity';
import { LegacyIntake } from './legacy-intake.entity';
import { LegacyPatient } from './legacy-patient.entity';

/**
 * The three legacy data tables.
 *
 * This module is not optional structure. The connection runs with
 * `autoLoadEntities: true`, and that only picks up entities registered through
 * `TypeOrmModule.forFeature` — an entity file nobody imports is invisible to the
 * schema sync, so without this module the tables never exist.
 *
 * `TypeOrmModule` is re-exported so the three repositories are injectable from
 * any module that imports this one, rather than every consumer repeating the
 * same `forFeature` list.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LegacyPatient, LegacyIntake, LegacyConsent])],
  exports: [TypeOrmModule],
})
export class LegacyModule {}
