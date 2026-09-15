import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConsentModule } from '../consent/consent.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { PatientModule } from '../patient/patient.module';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';

/** The intake form's API (2.3, 2.9): B1's state machine, B2's validators and engine, wired behind `POST/PATCH/GET /intakes*`. */
@Module({
  imports: [PatientModule, ConsentModule, EligibilityModule, AuditModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
