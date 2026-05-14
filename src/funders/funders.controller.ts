import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { FundersService } from './funders.service';
import { FunderQueryDto } from './dto/funder-query.dto';
import { CreateFunderDto } from './dto/create-funder.dto';
import { UpdateFunderDto } from './dto/update-funder.dto';

@ApiTags('Funders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('funders')
export class FundersController {
  constructor(private readonly service: FundersService) {}

  @Get()
  @Permissions('funders.read')
  @ApiOperation({ summary: 'List funders' })
  @ApiResponse({ status: 200 })
  list(@Query() query: FunderQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('funders.read')
  @ApiOperation({ summary: 'Get funder by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('funders.create')
  @ApiOperation({ summary: 'Create funder' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateFunderDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('funders.update')
  @ApiOperation({ summary: 'Update funder' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateFunderDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('funders.delete')
  @ApiOperation({ summary: 'Soft-delete funder' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
