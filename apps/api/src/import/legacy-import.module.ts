import { Module } from '@nestjs/common';
import { LegacyModule } from '../legacy/legacy.module';
import { LegacyImportService } from './legacy-import.service';

/**
 * The import.
 *
 * `LegacyModule` is imported because the three entities only reach the
 * connection through its `forFeature` registration — without it the tables the
 * import writes into would not exist.
 */
@Module({
  imports: [LegacyModule],
  providers: [LegacyImportService],
  exports: [LegacyImportService],
})
export class LegacyImportModule {}
