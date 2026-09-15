import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentEvent } from './consent-event.entity';

/** Owns `consent_event` (2.0, 2.1.2). No service of its own yet — B3's submit flow is the first writer, and it will add one when it exists. */
@Module({
  imports: [TypeOrmModule.forFeature([ConsentEvent])],
  exports: [TypeOrmModule],
})
export class ConsentModule {}
