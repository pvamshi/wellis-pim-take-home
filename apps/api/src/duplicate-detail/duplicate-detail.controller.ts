import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { DuplicateDetailService, type DuplicateDetail } from '../rules/duplicate-detail.service';

/** A link expanded (1.7.4): the service's shape unchanged, named here for one shared import. */
export type DuplicateDetailResponse = DuplicateDetail;

/**
 * The endpoint behind expanding a link (1.7.4).
 *
 * It delegates and nothing else. The read is `DuplicateDetailService`'s,
 * exported from `RulesModule` for exactly this — the same division
 * `row-detail/` keeps for the rows screen's own expanded view.
 *
 * A sibling of `duplicates-list/`, exactly as `row-detail/` sits beside
 * `rows-list/`, sharing the `duplicates` prefix: `GET /duplicates/:id`
 * cannot shadow `GET /duplicates`.
 *
 * The 404 is here, not in the service: `DuplicateDetailService.detail`
 * answers null for an id no link carries, and HTTP status is the
 * controller's to choose, the same line `RowDetailController` draws.
 */
@Controller('duplicates')
export class DuplicateDetailController {
  constructor(private readonly duplicates: DuplicateDetailService) {}

  @Get(':id')
  async detail(@Param('id') id: string): Promise<DuplicateDetailResponse> {
    const detail = await this.duplicates.detail(id);

    if (detail === null) {
      throw new NotFoundException(`there is no duplicate link "${id}"`);
    }

    return detail;
  }
}
