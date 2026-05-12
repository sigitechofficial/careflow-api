import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ComplianceRequirementsService } from './compliance-requirements.service';
import { ComplianceRequirementQueryDto } from './dto/compliance-requirement-query.dto';
import { CreateComplianceRequirementDto } from './dto/create-compliance-requirement.dto';
import { UpdateComplianceRequirementDto } from './dto/update-compliance-requirement.dto';

@ApiTags('Compliance Requirements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance-requirements')
export class ComplianceRequirementsController {
  constructor(private readonly service: ComplianceRequirementsService) {}

  @Get()
  @Permissions('compliance_requirements.read')
  @ApiOperation({ summary: 'List compliance requirements' })
  list(@Query() query: ComplianceRequirementQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('compliance_requirements.read')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('compliance_requirements.create')
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateComplianceRequirementDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('compliance_requirements.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateComplianceRequirementDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('compliance_requirements.delete')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
