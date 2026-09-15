import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { PatientModule } from '../patient/patient.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

/**
 * The review screen's API (2.4, 2.9): the queue and detail reads, and the
 * start/decide presses, both `IntakeStateMachine.transition` underneath.
 *
 * `AuditEvent` (the status history 2.4 asks for) needs no import of its own:
 * `AuditModule` re-exports no `TypeOrmModule` for it to grant, and — like
 * `intake-state-machine.spec.ts`'s own reads of the same table — the
 * connection's `autoLoadEntities` already makes it visible to
 * `DataSource.getRepository` wherever `AuditModule` registered it (at the app
 * root), with no per-module wiring to repeat.
 */
@Module({
  imports: [PatientModule, ConsentModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
