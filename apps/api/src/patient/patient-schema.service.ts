import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { patientTriggerStatements } from './patient-triggers';

/**
 * Creates `patient`'s two triggers on boot (2.2). There are no migrations —
 * `synchronize: true` is what creates the table itself — so this is that same
 * pattern's answer for the one thing `synchronize` cannot express: a trigger.
 *
 * Runs in `onModuleInit`, after Nest has finished resolving this module's
 * dependencies — which includes `DataSource`, and so includes `synchronize`
 * having already created `patient` — so the trigger statements always find
 * the table they name already there.
 */
@Injectable()
export class PatientSchemaService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    for (const statement of patientTriggerStatements()) {
      await this.dataSource.query(statement);
    }
  }
}
