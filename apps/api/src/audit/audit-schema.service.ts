import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { auditTriggerStatements } from './audit-triggers';

/** Creates `audit_event`'s two append-only triggers on boot. See `PatientSchemaService` for why this lives in `onModuleInit`. */
@Injectable()
export class AuditSchemaService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    for (const statement of auditTriggerStatements()) {
      await this.dataSource.query(statement);
    }
  }
}
