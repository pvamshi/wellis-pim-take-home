import { Controller, Get } from '@nestjs/common';
import { RuleListService, type RuleListEntry } from '../rules/rule-list.service';

/**
 * The rules screen's list (1.2.1): one line per rule with work waiting.
 *
 * A bare array rather than `{ rules: [...] }`. The presses report on what they
 * did and wrap their counters for that reason; this endpoint answers one
 * question, and there is nothing about the read worth reporting beside the
 * answer.
 */
export type RulesListResponse = RuleListEntry[];

/**
 * The endpoint the rules screen loads (1.2.1).
 *
 * It delegates and nothing else. The join is `RuleListService`'s, which lives
 * in the module that owns the rules tables (1.1.3) and is exported from it for
 * exactly this — the same division `approve/`, `decline/` and `apply-rules/`
 * already keep between a press and the layer it presses on.
 *
 * Three things the code does not say on its own:
 *
 * - **It shares the `rules` prefix with the four POSTs.** A screen that reads
 *   from one place and writes to another would be the odd shape here; the verb
 *   is what separates them.
 * - **No `@HttpCode`.** Nest answers a GET with 200 already; the presses
 *   override only because a POST defaults to 201.
 * - **No body, no params, no validation pipe.** The endpoint takes no input at
 *   all: which rules are listed is decided by `rule_version` and the rule rows
 *   (1.2.1), never by the caller. There is no pagination and no cache either —
 *   the list is bounded by the number of rules, and "Apply rules" re-reads from
 *   scratch anyway (1.2.10), so a stale line is not a state the screen has to
 *   be able to show.
 */
@Controller('rules')
export class RulesListController {
  constructor(private readonly rules: RuleListService) {}

  @Get()
  async list(): Promise<RulesListResponse> {
    return await this.rules.list();
  }
}
