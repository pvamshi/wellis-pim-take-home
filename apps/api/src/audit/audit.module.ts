import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEvent } from './audit-event.entity';
import { AuditSchemaService } from './audit-schema.service';
import { AuditWriter } from './audit-writer.service';

/** Owns `audit_event` (2.0, 2.8): the table, its append-only triggers, and the one writer of it. */
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditWriter, AuditSchemaService],
  exports: [AuditWriter],
})
export class AuditModule {}
