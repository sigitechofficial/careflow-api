import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ComplianceTypesService } from './compliance-types.service';
import { ComplianceTypeQueryDto } from './dto/compliance-type-query.dto';
import { CreateComplianceTypeDto } from './dto/create-compliance-type.dto';
import { UpdateComplianceTypeDto } from './dto/update-compliance-type.dto';

@ApiTags('Compliance Types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance-types')
export class ComplianceTypesController {
  constructor(private readonly service: ComplianceTypesService) {}

  @Get()
  @Permissions('compliance_types.read')
  @ApiOperation({ summary: 'List compliance types' })
  @ApiResponse({ status: 200 })
  list(@Query() query: ComplianceTypeQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('compliance_types.read')
  @ApiOperation({ summary: 'Get compliance type by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('compliance_types.create')
  @ApiOperation({ summary: 'Create compliance type' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateComplianceTypeDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('compliance_types.update')
  @ApiOperation({ summary: 'Update compliance type' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateComplianceTypeDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('compliance_types.delete')
  @ApiOperation({ summary: 'Soft-delete compliance type' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
