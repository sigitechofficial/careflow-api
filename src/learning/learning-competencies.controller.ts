import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
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
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCompetencyDto,
    @Req() req: Request,
  ) {
    return this.service.create(dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Patch('competencies/:id')
  @Permissions('learning.competencies.manage')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCompetencyDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Delete('competencies/:id')
  @Permissions('learning.competencies.manage')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.softDelete(id, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
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
