import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  AssignAgainDto,
  ExtendAssignmentWithReasonDto,
  MarkLessonsDto,
  RecordOutcomeDto,
  RecordAssignmentReviewDto,
} from './dto/learning.dto';
import { LearningAssignmentReviewsService } from './learning-assignment-reviews.service';

/** Overdue / late training: full record, extend, reasons and actions (16 Nov 2026). */
@ApiTags('Learning — Assignment reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning')
export class LearningAssignmentReviewsController {
  constructor(private readonly service: LearningAssignmentReviewsService) {}

  @Get('assignment-review-options')
  @Permissions('learning.assignments.read')
  @ApiOperation({ summary: 'Reasons and actions to choose from' })
  options() {
    return this.service.options();
  }

  @Get('assignments/:id/record')
  @Permissions('learning.assignments.read')
  @ApiOperation({ summary: 'Everything recorded for one assignment (lessons, quizzes, sessions, reviews)' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post('assignments/:id/extend-with-reason')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'New due date with a reason; an overdue course opens again' })
  extend(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendAssignmentWithReasonDto,
    @Req() req: Request,
  ) {
    return this.service.extend(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post('assignments/:id/reviews')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Record a reason and actions, or mark the course not completed' })
  record(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordAssignmentReviewDto,
    @Req() req: Request,
  ) {
    return this.service.record(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post('assignments/:id/outcome')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Manager outcome (Passed / Not passed) for a face to face or workplace course' })
  outcome(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordOutcomeDto,
    @Req() req: Request,
  ) {
    return this.service.recordOutcome(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post('assignments/:id/start')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Face to face: the office starts the course for the carer' })
  start(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.startCourse(id, user.id, getRequestAuditMeta(req));
  }

  @Post('assignments/:id/lessons/mark')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Face to face: the office marks lessons done or not done' })
  markLessons(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkLessonsDto,
    @Req() req: Request,
  ) {
    return this.service.markLessons(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post('assignments/:id/assign-again')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Give a failed or not completed course to the carer again' })
  assignAgain(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAgainDto,
    @Req() req: Request,
  ) {
    return this.service.assignAgain(id, user.id, dto, getRequestAuditMeta(req));
  }
}
