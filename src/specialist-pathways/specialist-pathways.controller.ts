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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SpecialistPathwaysService } from './specialist-pathways.service';
import { CreateSpecialistPathwayCaseDto } from './dto/create-case.dto';
import { UpdateSpecialistPathwayCaseDto } from './dto/update-case.dto';
import { CreateSpecialistPathwayPlanDto } from './dto/create-plan.dto';
import { UpdateSpecialistPathwayPlanDto } from './dto/update-plan.dto';
import { SpecialistPathwayPlanDecisionDto } from './dto/plan-decision.dto';
import { ListSpecialistPathwayCasesQueryDto } from './dto/list-cases-query.dto';
import { CreatePathwayRiskDto, UpdatePathwayRiskDto } from './dto/risk.dto';
import { ClosePathwayCaseDto, CreatePathwayReviewDto } from './dto/review.dto';
import { CreatePathwayProfessionalDto, UpdatePathwayProfessionalDto } from './dto/professional.dto';
import { CreatePathwayDocumentDto } from './dto/document.dto';
import { pathwayDocumentUploadOptions } from './pathway-document.config';

@ApiTags('Specialist pathways')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('specialist-pathways')
export class SpecialistPathwaysController {
  constructor(private readonly service: SpecialistPathwaysService) {}

  @Get()
  @AnyPermission('specialist_pathways.read', 'specialist_pathways.manage')
  @ApiOperation({ summary: 'List specialist pathway cases (branch-scoped)' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListSpecialistPathwayCasesQueryDto) {
    return this.service.list(user, query);
  }

  @Get('summary')
  @AnyPermission('specialist_pathways.read', 'specialist_pathways.manage')
  @ApiOperation({ summary: 'Per-pathway counts for the module dashboard' })
  summary(@CurrentUser() user: RequestUser, @Query() query: ListSpecialistPathwayCasesQueryDto) {
    return this.service.summary(user, query.locationId);
  }

  @Get(':id')
  @AnyPermission('specialist_pathways.read', 'specialist_pathways.manage')
  @ApiOperation({ summary: 'Get a pathway case with plans, risks, reviews and activity' })
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(user, id);
  }

  @Post()
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Create a pathway case for a service user' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSpecialistPathwayCaseDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Update a pathway case (sections, status, review date)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateSpecialistPathwayCaseDto,
    @Req() req: Request,
  ) {
    return this.service.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/close')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Close a case (reason required)' })
  close(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ClosePathwayCaseDto,
    @Req() req: Request,
  ) {
    return this.service.close(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/reopen')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Reopen a closed case' })
  reopen(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.reopen(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/risks')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Add a risk assessment to a case' })
  addRisk(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreatePathwayRiskDto,
    @Req() req: Request,
  ) {
    return this.service.addRisk(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/risks/:riskId')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Update or close a risk' })
  updateRisk(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('riskId') riskId: string,
    @Body() dto: UpdatePathwayRiskDto,
    @Req() req: Request,
  ) {
    return this.service.updateRisk(user, id, riskId, dto, getRequestAuditMeta(req));
  }

  @Post(':id/reviews')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Record a review (sets the next review date)' })
  addReview(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreatePathwayReviewDto,
    @Req() req: Request,
  ) {
    return this.service.addReview(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/professionals')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Add a professional involved in the case' })
  addProfessional(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreatePathwayProfessionalDto,
    @Req() req: Request,
  ) {
    return this.service.addProfessional(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/professionals/:professionalId')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Update a professional' })
  updateProfessional(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('professionalId') professionalId: string,
    @Body() dto: UpdatePathwayProfessionalDto,
    @Req() req: Request,
  ) {
    return this.service.updateProfessional(user, id, professionalId, dto, getRequestAuditMeta(req));
  }

  @Delete(':id/professionals/:professionalId')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Remove a professional from the case' })
  removeProfessional(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('professionalId') professionalId: string,
    @Req() req: Request,
  ) {
    return this.service.removeProfessional(user, id, professionalId, getRequestAuditMeta(req));
  }

  @Post(':id/documents')
  @Permissions('specialist_pathways.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', pathwayDocumentUploadOptions))
  @ApiOperation({ summary: 'Upload a document to the case (PDF, JPEG, PNG, WebP)' })
  addDocument(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreatePathwayDocumentDto,
    @Req() req: Request,
  ) {
    return this.service.addDocument(user, id, file, dto, getRequestAuditMeta(req));
  }

  @Get(':id/documents/:documentId/download')
  @AnyPermission('specialist_pathways.read', 'specialist_pathways.manage')
  @ApiOperation({ summary: 'Download a case document (authenticated, branch-scoped)' })
  async downloadDocument(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const file = await this.service.getDocumentForDownload(user, id, documentId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    return res.sendFile(file.absolutePath);
  }

  @Delete(':id/documents/:documentId')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Remove a case document' })
  removeDocument(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    return this.service.removeDocument(user, id, documentId, getRequestAuditMeta(req));
  }

  @Post(':id/plans')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Create a new draft care plan version' })
  createPlan(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateSpecialistPathwayPlanDto,
    @Req() req: Request,
  ) {
    return this.service.createPlan(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/plans/:planId')
  @Permissions('specialist_pathways.manage')
  @ApiOperation({ summary: 'Edit a draft care plan, or submit it for approval' })
  updatePlan(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('planId') planId: string,
    @Body() dto: UpdateSpecialistPathwayPlanDto,
    @Req() req: Request,
  ) {
    return this.service.updatePlan(user, id, planId, dto, getRequestAuditMeta(req));
  }

  @Post(':id/plans/:planId/decision')
  @Permissions('specialist_pathways.approve')
  @ApiOperation({ summary: 'Approve or return a submitted care plan' })
  decidePlan(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('planId') planId: string,
    @Body() dto: SpecialistPathwayPlanDecisionDto,
    @Req() req: Request,
  ) {
    return this.service.decidePlan(user, id, planId, dto, getRequestAuditMeta(req));
  }
}
