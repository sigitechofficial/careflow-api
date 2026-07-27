import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  CreateAssessmentQuestionDto,
  CreateLearningAssessmentDto,
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
    @Param('versionId') versionId: string,
    @Body() dto: CreateLearningAssessmentDto,
  ) {
    return this.service.createAssessment(versionId, dto);
  }

  @Patch('learning/assessments/:id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update assessment' })
  updateAssessment(@Param('id') id: string, @Body() dto: UpdateLearningAssessmentDto) {
    return this.service.updateAssessment(id, dto);
  }

  @Delete('learning/assessments/:id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Delete assessment' })
  deleteAssessment(@Param('id') id: string) {
    return this.service.deleteAssessment(id);
  }

  @Post('learning/assessments/:id/questions')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Add assessment question' })
  createQuestion(@Param('id') id: string, @Body() dto: CreateAssessmentQuestionDto) {
    return this.service.createQuestion(id, dto);
  }

  @Patch('learning/questions/:id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update assessment question' })
  updateQuestion(@Param('id') id: string, @Body() dto: UpdateAssessmentQuestionDto) {
    return this.service.updateQuestion(id, dto);
  }

  @Delete('learning/questions/:id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Delete assessment question' })
  deleteQuestion(@Param('id') id: string) {
    return this.service.deleteQuestion(id);
  }
}
