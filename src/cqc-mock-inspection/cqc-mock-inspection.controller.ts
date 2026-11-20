import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CqcMockInspectionService } from './cqc-mock-inspection.service';
import { CqcMockInspectionSurveysService } from './cqc-mock-inspection-surveys.service';
import { CqcMockInspectionPoliciesService } from './cqc-mock-inspection-policies.service';
import {
  CreateCqcMockActionDto,
  CreateCqcMockInspectionDto,
  ListCqcMockInspectionsQueryDto,
  ScoreStatementDto,
  UpdateCqcMockActionDto,
  UpdateCqcMockInspectionDto,
} from './dto/cqc-mock-inspection.dto';

/**
 * Governance → Mock CQC inspection. Read: cqc_mock_inspection.read; start, score, complete,
 * cancel and actions: cqc_mock_inspection.manage.
 */
@ApiTags('Mock CQC inspection')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cqc-mock-inspections')
export class CqcMockInspectionController {
  constructor(
    private readonly inspections: CqcMockInspectionService,
    private readonly surveys: CqcMockInspectionSurveysService,
    private readonly policies: CqcMockInspectionPoliciesService,
  ) {}

  @Get()
  @Permissions('cqc_mock_inspection.read')
  @ApiOperation({ summary: 'Mock inspections (filters: status, branch)' })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListCqcMockInspectionsQueryDto,
  ) {
    return this.inspections.list(user, query);
  }

  @Post()
  @Permissions('cqc_mock_inspection.manage')
  @ApiOperation({
    summary:
      'Start a mock inspection of a branch or the whole organisation (takes the current evidence)',
  })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCqcMockInspectionDto,
    @Req() req: Request,
  ) {
    return this.inspections.create(user, dto, getRequestAuditMeta(req));
  }

  @Get('statement-policies')
  @Permissions('policies.read')
  @ApiOperation({
    summary:
      'Ready-made policies behind each quality statement (statement code → policies)',
  })
  statementPolicies() {
    return this.policies.byStatement();
  }

  @Get('statement-surveys')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({
    summary:
      'Ready-made surveys for each quality statement (statement code → surveys)',
  })
  statementSurveys() {
    return this.surveys.byStatement();
  }

  @Get('templates')
  @Permissions('cqc_mock_inspection.read')
  @ApiOperation({
    summary:
      'Ready-made mock inspections: their statements and what to check for each',
  })
  templates() {
    return this.inspections.templates();
  }

  @Get(':id')
  @Permissions('cqc_mock_inspection.read')
  @ApiOperation({
    summary:
      'One mock inspection: statements by key question, evidence, scores, ratings and actions',
  })
  get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inspections.get(user, id);
  }

  @Get(':id/comparison')
  @Permissions('cqc_mock_inspection.read')
  @ApiOperation({
    summary:
      'Compared with the previous completed inspection of the same service',
  })
  comparison(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inspections.comparison(user, id);
  }

  @Get(':id/export')
  @Permissions('cqc_mock_inspection.read')
  @ApiOperation({
    summary:
      'The inspection report as a PDF (ratings, scores, evidence and actions)',
  })
  async export(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.inspections.export(
      user,
      id,
      getRequestAuditMeta(req),
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', file.disposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  }

  @Patch(':id')
  @Permissions('cqc_mock_inspection.manage')
  @ApiOperation({
    summary: 'Change the title, notes or lead reviewer (in progress only)',
  })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCqcMockInspectionDto,
    @Req() req: Request,
  ) {
    return this.inspections.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/statements/:statementId')
  @Permissions('cqc_mock_inspection.manage')
  @ApiOperation({
    summary:
      'Score a quality statement and record strengths, concerns and notes',
  })
  scoreStatement(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('statementId', ParseUUIDPipe) statementId: string,
    @Body() dto: ScoreStatementDto,
    @Req() req: Request,
  ) {
    return this.inspections.scoreStatement(
      user,
      id,
      statementId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/refresh-evidence')
  @Permissions('cqc_mock_inspection.manage')
  @ApiOperation({
    summary: 'Take the current evidence again (scores and notes are kept)',
  })
  refreshEvidence(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.inspections.refreshEvidence(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/complete')
  @Permissions('cqc_mock_inspection.manage')
  @ApiOperation({
    summary:
      'Complete the inspection and freeze its ratings (every statement must be scored)',
  })
  complete(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.inspections.complete(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/cancel')
  @Permissions('cqc_mock_inspection.manage')
  @ApiOperation({ summary: 'Cancel an inspection in progress' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.inspections.cancel(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/actions')
  @Permissions('cqc_mock_inspection.manage')
  @ApiOperation({ summary: 'Add an improvement action' })
  createAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCqcMockActionDto,
    @Req() req: Request,
  ) {
    return this.inspections.createAction(
      user,
      id,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Patch(':id/actions/:actionId')
  @Permissions('cqc_mock_inspection.manage')
  @ApiOperation({ summary: 'Change an improvement action or mark it done' })
  updateAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: UpdateCqcMockActionDto,
    @Req() req: Request,
  ) {
    return this.inspections.updateAction(
      user,
      id,
      actionId,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
