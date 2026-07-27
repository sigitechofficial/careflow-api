import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  CreateCompetencyAssessmentDto,
  CreateCompetencyDto,
  LearningListQueryDto,
  ReviewCompetencyAssessmentDto,
  UpdateCompetencyDto,
} from './dto/learning.dto';
import { LearningCompetenciesService } from './learning-competencies.service';

@ApiTags('Learning — Competencies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning')
export class LearningCompetenciesController {
  constructor(private readonly service: LearningCompetenciesService) {}

  @Get('competencies')
  @Permissions('learning.competencies.read')
  list(@Query() query: LearningListQueryDto) {
    return this.service.list(query);
  }

  @Get('competencies/:id')
  @Permissions('learning.competencies.read')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post('competencies')
  @Permissions('learning.competencies.manage')
  create(@Body() dto: CreateCompetencyDto) {
    return this.service.create(dto);
  }

  @Patch('competencies/:id')
  @Permissions('learning.competencies.manage')
  update(@Param('id') id: string, @Body() dto: UpdateCompetencyDto) {
    return this.service.update(id, dto);
  }

  @Delete('competencies/:id')
  @Permissions('learning.competencies.manage')
  remove(@Param('id') id: string) {
    return this.service.softDelete(id);
  }

  @Get('competency-assessments')
  @Permissions('learning.competencies.read')
  listAssessments(@Query() query: LearningListQueryDto & { employeeId?: string; competencyId?: string }) {
    return this.service.listAssessments(query);
  }

  @Post('competency-assessments')
  @Permissions('learning.competencies.manage')
  createAssessment(@Body() dto: CreateCompetencyAssessmentDto) {
    return this.service.createAssessment(dto);
  }

  @Post('competency-assessments/:id/submit')
  @Permissions('learning.competencies.manage')
  submit(@Param('id') id: string) {
    return this.service.submitAssessment(id);
  }

  @Post('competency-assessments/:id/approve')
  @Permissions('learning.competencies.manage')
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewCompetencyAssessmentDto,
  ) {
    return this.service.approveAssessment(id, user.id, dto);
  }

  @Post('competency-assessments/:id/reject')
  @Permissions('learning.competencies.manage')
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewCompetencyAssessmentDto,
  ) {
    return this.service.rejectAssessment(id, user.id, dto);
  }
}
