import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { PortalAuthGuard } from '../service-user-portal/guards/portal-auth.guard';
import { SurveysService } from './surveys.service';

@ApiTags('Service User Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PortalAuthGuard)
@Controller('portal/surveys')
export class SurveysPortalController {
  constructor(private readonly service: SurveysService) {}

  @Get()
  @ApiOperation({ summary: 'Surveys sent to the signed-in service user' })
  list(@CurrentUser() user: RequestUser) {
    return this.service.listForServiceUserPortal(user.serviceUserId!);
  }

  @Get(':token/answers')
  @ApiOperation({
    summary: 'Answers the signed-in service user submitted for a survey',
  })
  answers(@CurrentUser() user: RequestUser, @Param('token') token: string) {
    return this.service.getPortalSurveyAnswers(user.serviceUserId!, token);
  }
}
