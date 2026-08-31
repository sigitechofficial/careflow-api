import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AnyPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { RecruitmentSummaryService } from './recruitment-summary.service';

@ApiTags('HR Recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/recruitment')
export class RecruitmentSummaryController {
  constructor(private readonly summaryService: RecruitmentSummaryService) {}

  @Get('summary')
  @AnyPermission('hr.vacancies.read', 'hr.candidates.read')
  summary(@CurrentUser() user: RequestUser) {
    return this.summaryService.getSummary(user);
  }
}
