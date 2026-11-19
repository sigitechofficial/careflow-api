import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import {
  CurrentUser,
  type RequestUser,
} from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  CreateAssessmentQuestionDto,
  CreateLearningAssessmentDto,
  ReorderAssessmentQuestionsDto,
  UpdateAssessmentQuestionDto,
  UpdateLearningAssessmentDto,
} from './dto/learning.dto';
import { LearningAssessmentsService } from './learning-assessments.service';

@ApiTags('Learning — Assessments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class LearningAssessmentsController {
  constructor(private readonly service: LearningAssessmentsService) {}

  @Post('learning/course-versions/:versionId/assessments')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Create assessment on DRAFT version' })
  createAssessment(
    @CurrentUser() user: RequestUser,
    @Param('versionId') versionId: string,
    @Body() dto: CreateLearningAssessmentDto,
    @Req() req: Request,
  ) {
    return this.service.createAssessment(versionId, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Patch('learning/assessments/:id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update assessment' })
  updateAssessment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateLearningAssessmentDto,
    @Req() req: Request,
  ) {
    return this.service.updateAssessment(id, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Delete('learning/assessments/:id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Delete assessment' })
  deleteAssessment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.deleteAssessment(id, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Post('learning/assessments/:id/questions')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Add assessment question' })
  createQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateAssessmentQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.createQuestion(id, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Post('learning/assessments/:id/reorder-questions')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Set the order of every question in a quiz' })
  reorderQuestions(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReorderAssessmentQuestionsDto,
    @Req() req: Request,
  ) {
    return this.service.reorderQuestions(id, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Patch('learning/questions/:id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update assessment question' })
  updateQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateAssessmentQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.updateQuestion(id, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Delete('learning/questions/:id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Delete assessment question' })
  deleteQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.deleteQuestion(id, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }
}
