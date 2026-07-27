import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  CompleteContentDto,
  ManagerApprovalDto,
  SubmitAssessmentAttemptDto,
} from './dto/learning.dto';
import { LearningMeService } from './learning-me.service';

@ApiTags('Learning — Me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/me')
export class LearningMeController {
  constructor(private readonly service: LearningMeService) {}

  @Get('dashboard')
  @Permissions('learning.me.read')
  @ApiOperation({ summary: 'Employee learning dashboard summary' })
  dashboard(@CurrentUser() user: RequestUser) {
    return this.service.getDashboard(user);
  }

  @Get('assignments')
  @Permissions('learning.me.read')
  @ApiOperation({ summary: 'My assignments' })
  assignments(@CurrentUser() user: RequestUser) {
    return this.service.listAssignments(user);
  }

  @Get('assignments/:id')
  @Permissions('learning.me.read')
  @ApiOperation({ summary: 'My assignment detail' })
  assignment(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getAssignment(user, id);
  }

  @Post('assignments/:assignmentId/content/:contentId/complete')
  @Permissions('learning.me.progress')
  @ApiOperation({ summary: 'Complete content item' })
  completeContent(
    @CurrentUser() user: RequestUser,
    @Param('assignmentId') assignmentId: string,
    @Param('contentId') contentId: string,
    @Body() dto: CompleteContentDto,
  ) {
    return this.service.completeContent(user, assignmentId, contentId, dto);
  }

  @Post('assignments/:assignmentId/assessments/:assessmentId/start')
  @Permissions('learning.me.progress')
  @ApiOperation({ summary: 'Start assessment attempt' })
  startAssessment(
    @CurrentUser() user: RequestUser,
    @Param('assignmentId') assignmentId: string,
    @Param('assessmentId') assessmentId: string,
  ) {
    return this.service.startAssessmentAttempt(user, assignmentId, assessmentId);
  }

  @Post('assignments/:assignmentId/assessments/:assessmentId/submit')
  @Permissions('learning.me.progress')
  @ApiOperation({ summary: 'Submit assessment attempt' })
  submitAssessment(
    @CurrentUser() user: RequestUser,
    @Param('assignmentId') assignmentId: string,
    @Param('assessmentId') assessmentId: string,
    @Body() dto: SubmitAssessmentAttemptDto,
  ) {
    return this.service.submitAssessmentAttempt(user, assignmentId, assessmentId, dto);
  }

  @Get('progress')
  @Permissions('learning.me.progress')
  @ApiOperation({ summary: 'My progress records' })
  progress(@CurrentUser() user: RequestUser) {
    return this.service.listProgress(user);
  }

  @Get('certificates')
  @Permissions('learning.me.read')
  @ApiOperation({ summary: 'My certificates' })
  certificates(@CurrentUser() user: RequestUser) {
    return this.service.listCertificates(user);
  }

  @Post('assignments/:id/approve')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Manager approve assignment completion' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ManagerApprovalDto,
  ) {
    return this.service.approveAssignment(user, id, dto);
  }
}
