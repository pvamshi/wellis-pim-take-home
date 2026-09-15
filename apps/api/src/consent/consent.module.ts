import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentEvent } from './consent-event.entity';
import { ConsentEventsService } from './consent-events.service';

/**
 * Owns `consent_event` (2.0, 2.1.2), and `ConsentEventsService`, the one
 * shared read of it — B3's intake/review flow and B4's import both need a
 * patient's history, so it lives here rather than being written out twice.
 * Both still write their own events directly, through `TypeOrmModule`'s
 * repository: `origin`/`legacyRowId` differ by caller, so there is no shared
 * write to add.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ConsentEvent])],
  providers: [ConsentEventsService],
  exports: [TypeOrmModule, ConsentEventsService],
})
export class ConsentModule {}
