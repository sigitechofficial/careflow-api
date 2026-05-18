import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { InitialAssessmentTemplatesService } from './initial-assessment-templates.service';
import { InitialAssessmentTemplateQueryDto } from './dto/initial-assessment-template-query.dto';
import { CreateInitialAssessmentTemplateDto } from './dto/create-initial-assessment-template.dto';
import { UpdateInitialAssessmentTemplateDto } from './dto/update-initial-assessment-template.dto';
import { CreateInitialAssessmentSectionDto } from './dto/create-initial-assessment-section.dto';
import { UpdateInitialAssessmentSectionDto } from './dto/update-initial-assessment-section.dto';
import { CreateInitialAssessmentQuestionDto } from './dto/create-initial-assessment-question.dto';
import { UpdateInitialAssessmentQuestionDto } from './dto/update-initial-assessment-question.dto';

@ApiTags('Initial Assessment Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('initial-assessment-templates')
export class InitialAssessmentTemplatesController {
  constructor(private readonly service: InitialAssessmentTemplatesService) {}

  @Get()
  @AnyPermission('initial_assessment_templates.read', 'service_users.initial_assessment.read')
  @ApiOperation({ summary: 'List initial assessment templates' })
  list(@Query() query: InitialAssessmentTemplateQueryDto) {
    return this.service.getTemplates(query);
  }

  @Get('default')
  @AnyPermission('initial_assessment_templates.read', 'service_users.initial_assessment.read')
  @ApiOperation({ summary: 'Get default initial assessment template with sections and questions' })
  getDefault() {
    return this.service.getDefaultTemplate();
  }

  @Get(':id')
  @AnyPermission('initial_assessment_templates.read', 'service_users.initial_assessment.read')
  getById(@Param('id') id: string) {
    return this.service.getTemplateById(id);
  }

  @Post()
  @Permissions('initial_assessment_templates.create')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateInitialAssessmentTemplateDto, @Req() req: Request) {
    return this.service.createTemplate(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('initial_assessment_templates.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateInitialAssessmentTemplateDto,
    @Req() req: Request,
  ) {
    return this.service.updateTemplate(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('initial_assessment_templates.delete')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.softDeleteTemplate(user.id, id, getRequestAuditMeta(req));
  }

  @Get(':templateId/sections')
  @AnyPermission('initial_assessment_templates.read', 'service_users.initial_assessment.read')
  listSections(@Param('templateId') templateId: string) {
    return this.service.getSections(templateId);
  }

  @Post(':templateId/sections')
  @Permissions('initial_assessment_templates.update')
  createSection(
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
    @Body() dto: CreateInitialAssessmentSectionDto,
    @Req() req: Request,
  ) {
    return this.service.createSection(user.id, templateId, dto, getRequestAuditMeta(req));
  }

  @Patch(':templateId/sections/:sectionId')
  @Permissions('initial_assessment_templates.update')
  updateSection(
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateInitialAssessmentSectionDto,
    @Req() req: Request,
  ) {
    return this.service.updateSection(user.id, templateId, sectionId, dto, getRequestAuditMeta(req));
  }

  @Delete(':templateId/sections/:sectionId')
  @Permissions('initial_assessment_templates.update')
  deleteSection(
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
    @Param('sectionId') sectionId: string,
    @Req() req: Request,
  ) {
    return this.service.softDeleteSection(user.id, templateId, sectionId, getRequestAuditMeta(req));
  }

  @Get(':templateId/questions')
  @AnyPermission('initial_assessment_templates.read', 'service_users.initial_assessment.read')
  listQuestions(@Param('templateId') templateId: string) {
    return this.service.getQuestions(templateId);
  }

  @Post(':templateId/sections/:sectionId/questions')
  @Permissions('initial_assessment_templates.update')
  createQuestion(
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: CreateInitialAssessmentQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.createQuestion(user.id, templateId, sectionId, dto, getRequestAuditMeta(req));
  }

  @Patch(':templateId/questions/:questionId')
  @Permissions('initial_assessment_templates.update')
  updateQuestion(
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateInitialAssessmentQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.updateQuestion(user.id, templateId, questionId, dto, getRequestAuditMeta(req));
  }

  @Delete(':templateId/questions/:questionId')
  @Permissions('initial_assessment_templates.update')
  deleteQuestion(
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
    @Param('questionId') questionId: string,
    @Req() req: Request,
  ) {
    return this.service.softDeleteQuestion(user.id, templateId, questionId, getRequestAuditMeta(req));
  }
}
