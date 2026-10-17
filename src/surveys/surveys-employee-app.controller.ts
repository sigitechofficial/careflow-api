import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeAppAuthGuard } from '../employee-app/guards/employee-app-auth.guard';
import { SubmitSurveyResponseDto } from './dto/submit-survey-response.dto';
import { SurveysService } from './surveys.service';

/** Carer app → Me → My surveys. Only the signed-in employee's own surveys. */
@ApiTags('Employee App Surveys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/surveys')
export class SurveysEmployeeAppController {
  constructor(private readonly service: SurveysService) {}

  @Get()
  @ApiOperation({ summary: 'Surveys sent to the signed-in carer (open ones include questions)' })
  list(@CurrentUser() user: RequestUser) {
    return this.service.listForEmployeeApp(user.employeeId!);
  }

  @Get(':token')
  @ApiOperation({ summary: 'Load one of my surveys to answer' })
  getForm(@CurrentUser() user: RequestUser, @Param('token') token: string) {
    return this.service.getEmployeeAppForm(user.employeeId!, token);
  }

  @Get(':token/answers')
  @ApiOperation({ summary: 'The answers I submitted for one of my surveys' })
  answers(@CurrentUser() user: RequestUser, @Param('token') token: string) {
    return this.service.getEmployeeAppAnswers(user.employeeId!, token);
  }

  @Post(':token/responses')
  @ApiOperation({ summary: 'Submit answers for one of my surveys (409 when already answered)' })
  submit(
    @CurrentUser() user: RequestUser,
    @Param('token') token: string,
    @Body() dto: SubmitSurveyResponseDto,
    @Req() req: Request,
  ) {
    return this.service.submitEmployeeAppResponse(
      user.employeeId!,
      token,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
