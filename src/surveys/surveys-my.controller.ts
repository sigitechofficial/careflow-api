import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitSurveyResponseDto } from './dto/submit-survey-response.dto';
import { SurveysService } from './surveys.service';
import { employeeForWebUser } from './survey-staff-answer-places';

/**
 * CareFlow web app → My surveys: surveys sent to the signed-in member of staff, for staff who answer on a
 * computer rather than in the carer app (e.g. office staff). The login is matched to the staff record by
 * email (as CareFlow already does for roles). Surveys are opened by survey, never by a personal link or
 * token: nothing in the address could show whether someone answered an anonymous survey.
 */
@ApiTags('My surveys (web)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('my-surveys')
export class SurveysMyController {
  constructor(
    private readonly service: SurveysService,
    private readonly prisma: PrismaService,
  ) {}

  private async employeeId(user: RequestUser): Promise<string | null> {
    if (user.accountKind !== 'user') throw new ForbiddenException('My surveys is for staff signed in to CareFlow.');
    return employeeForWebUser(this.prisma, user.email);
  }

  private async tokenFor(user: RequestUser, surveyId: string): Promise<{ employeeId: string; token: string }> {
    const employeeId = await this.employeeId(user);
    if (!employeeId) throw new NotFoundException('Survey not found');
    const row = await this.prisma.surveyRecipient.findFirst({
      where: { surveyId, employeeId, targetKind: 'EMPLOYEE' },
      select: { token: true },
    });
    if (!row) throw new NotFoundException('Survey not found');
    return { employeeId, token: row.token };
  }

  @Get()
  @ApiOperation({ summary: 'Surveys sent to me (the signed-in member of staff)' })
  async list(@CurrentUser() user: RequestUser) {
    const employeeId = await this.employeeId(user);
    if (!employeeId) return { message: 'My surveys', data: { linked: false, items: [] } };
    const res = await this.service.listForEmployeeApp(employeeId);
    // Never the token: surveys are opened by survey id.
    const items = res.data.map(({ token: _token, questions: _questions, sectionIntros: _intros, ...rest }) => rest);
    return { message: 'My surveys', data: { linked: true, items } };
  }

  @Get(':surveyId')
  @ApiOperation({ summary: 'Open one of my surveys to answer' })
  async form(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    const { employeeId, token } = await this.tokenFor(user, surveyId);
    return this.service.getEmployeeAppForm(employeeId, token);
  }

  @Post(':surveyId/responses')
  @ApiOperation({ summary: 'Submit my answers' })
  async submit(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: SubmitSurveyResponseDto,
    @Req() req: Request,
  ) {
    const { employeeId, token } = await this.tokenFor(user, surveyId);
    return this.service.submitEmployeeAppResponse(employeeId, token, dto, getRequestAuditMeta(req));
  }
}
