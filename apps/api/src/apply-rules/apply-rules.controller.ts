import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RuleFindingsService, type RuleFindingsReport } from '../rules/rule-findings.service';
import { RuleRunnerService } from '../rules/rule-runner.service';

/**
 * What one press of "Apply rules" did (1.2.10).
 *
 * `rules` is the persistence layer's report, one line per active rule version,
 * in the order the runner called them. `totals` is the same four counters
 * summed, plus how many versions ran — so a run can be checked by comparing
 * counts rather than by tracing rows, which is the precedent the importer set.
 *
 * The requirement is silent on a body, because the screen refreshes by
 * re-reading the rule rows and not from this response. It is informational.
 */
export interface ApplyRulesResponse {
  rules: RuleFindingsReport;
  totals: {
    versionsRun: number;
    found: number;
    declined: number;
    repeated: number;
    written: number;
  };
}

/** Sums a report's lines. `found = declined + repeated + written` still holds. */
function summarise(report: RuleFindingsReport): ApplyRulesResponse['totals'] {
  return report.reduce<ApplyRulesResponse['totals']>(
    (totals, line) => ({
      versionsRun: totals.versionsRun + 1,
      found: totals.found + line.found,
      declined: totals.declined + line.declined,
      repeated: totals.repeated + line.repeated,
      written: totals.written + line.written,
    }),
    { versionsRun: 0, found: 0, declined: 0, repeated: 0, written: 0 },
  );
}

/**
 * The endpoint behind "Apply rules" (1.2.10): run every active rule version
 * against the entire dataset, then write what came back as rule rows.
 *
 * It composes and nothing else. The run is `RuleRunnerService` (1.1.14) and the
 * write is `RuleFindingsService` (1.1.3), both of which already exist and are
 * exported from `RulesModule` for this; there is no `ApplyRulesService`,
 * because a service wrapping two awaited calls and a sum would be a layer for
 * its own sake.
 *
 * Three things the code does not say on its own:
 *
 * - **The run and the write are deliberately not one transaction.** Rules read
 *   the modified data, not a frozen snapshot (1.2.10), and a transaction around
 *   the pair would be exactly that snapshot — as well as a write path handed to
 *   code that must not write (1.1.2). The write already runs in a transaction
 *   of its own, which is the one that matters: a half-written findings set is
 *   one the rules screen would read as complete.
 * - **Nothing is caught.** An active version whose code a deploy lost, a rule
 *   that throws, a finding naming a source table that does not exist — all of
 *   them abort the run and surface as a 500 with no rule row written. That is
 *   the runner's stated contract, and the alternative is a findings set that
 *   looks complete and is not (1.1.1). None of these is a client fault, so none
 *   of them is mapped to a friendlier status.
 * - **Nothing guards against two presses at once.** The end user is one of us
 *   (1.2.12), and persistence only ever inserts addresses that were absent, so
 *   a second simultaneous run is at worst wasted work.
 *
 * The route sits under `rules` so the rules screen's read endpoints own the
 * same prefix, and it is a POST because the call writes.
 */
@Controller('rules')
export class ApplyRulesController {
  constructor(
    private readonly runner: RuleRunnerService,
    private readonly findings: RuleFindingsService,
  ) {}

  /**
   * 200 rather than Nest's default 201 for a POST: this creates no resource at
   * a URL, it reports on work it did.
   *
   * No body, no DTO and no validation pipe — the endpoint takes no input at
   * all. Which rules run is decided by `rule_version` rows (1.2.10), never by
   * the caller.
   */
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  async apply(): Promise<ApplyRulesResponse> {
    const result = await this.runner.run();
    const rules = await this.findings.persist(result);

    return { rules, totals: summarise(rules) };
  }
}
