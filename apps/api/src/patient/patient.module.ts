import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { IntakeStateMachine } from './intake-state-machine.service';
import { PatientSchemaService } from './patient-schema.service';
import { Patient } from './patient.entity';

/** Owns `patient` (2.0): the table, its two boot triggers, and the state machine — the only write to `intake_status`. */
@Module({
  imports: [TypeOrmModule.forFeature([Patient]), AuditModule],
  providers: [PatientSchemaService, IntakeStateMachine],
  exports: [TypeOrmModule, IntakeStateMachine],
})
export class PatientModule {}
