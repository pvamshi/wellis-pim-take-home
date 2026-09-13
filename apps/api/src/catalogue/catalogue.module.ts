import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rule } from '../rules/rule.entity';
import { RuleVersion } from '../rules/rule-version.entity';
import { CatalogueSyncService } from './catalogue-sync.service';

/**
 * The catalogue sync, which is a CLI concern rather than an API one. It is here
 * so the CLI can boot AppModule like every other entry point and get the same
 * DATABASE_URL resolution, not because anything served over HTTP uses it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Rule, RuleVersion])],
  providers: [CatalogueSyncService],
  exports: [CatalogueSyncService],
})
export class CatalogueModule {}
