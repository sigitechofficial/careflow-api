import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Each kind of record is searched only for someone with its own read permission (checked per kind). */
  @Get()
  @ApiOperation({ summary: 'Find anything: every kind of record the signed-in person may see, in one request' })
  find(@CurrentUser() user: RequestUser, @Query('q') q?: string) {
    return this.search.search(user, q ?? '');
  }
}
