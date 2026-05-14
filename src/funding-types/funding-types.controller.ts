import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { FundingTypesService } from './funding-types.service';
import { FundingTypeQueryDto } from './dto/funding-type-query.dto';
import { CreateFundingTypeDto } from './dto/create-funding-type.dto';
import { UpdateFundingTypeDto } from './dto/update-funding-type.dto';

@ApiTags('Funding Types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('funding-types')
export class FundingTypesController {
  constructor(private readonly service: FundingTypesService) {}

  @Get()
  @Permissions('funding_types.read')
  @ApiOperation({ summary: 'List funding types' })
  @ApiResponse({ status: 200 })
  list(@Query() query: FundingTypeQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('funding_types.read')
  @ApiOperation({ summary: 'Get funding type by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('funding_types.create')
  @ApiOperation({ summary: 'Create funding type' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateFundingTypeDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('funding_types.update')
  @ApiOperation({ summary: 'Update funding type' })
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateFundingTypeDto, @Req() req: Request) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('funding_types.delete')
  @ApiOperation({ summary: 'Soft-delete funding type' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
