import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeAllocationsService } from './employee-allocations.service';
import {
  CreateAllocationItemTypeDto,
  CreateEmployeeAllocationDto,
  EmployeeAllocationsRegistryQueryDto,
  UpdateAllocationItemTypeDto,
  UpdateEmployeeAllocationDto,
} from './dto/employee-allocation.dto';

@ApiTags('Employee Allocations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/allocations')
export class EmployeeAllocationsController {
  constructor(private readonly service: EmployeeAllocationsService) {}

  @Get()
  @Permissions('employees.read')
  list(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
  ) {
    return this.service.list(user, employeeId);
  }

  @Post()
  @Permissions('employees.update')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateEmployeeAllocationDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, employeeId, dto, getRequestAuditMeta(req));
  }

  @Patch(':allocationId')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() dto: UpdateEmployeeAllocationDto,
    @Req() req: Request,
  ) {
    return this.service.update(
      user,
      employeeId,
      allocationId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Delete(':allocationId')
  @Permissions('employees.update')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(
      user,
      employeeId,
      allocationId,
      getRequestAuditMeta(req),
    );
  }
}

@ApiTags('Employee Allocations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-allocations')
export class EmployeeAllocationsRegistryController {
  constructor(private readonly service: EmployeeAllocationsService) {}

  @Get()
  @Permissions('employees.read')
  @ApiOperation({ summary: 'Allocations across all employees in scope' })
  registry(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeAllocationsRegistryQueryDto,
  ) {
    return this.service.registry(user, query);
  }

  @Get('items')
  @Permissions('employees.read')
  @ApiOperation({
    summary: 'Items that can be allocated (Settings → Allocation items)',
  })
  async listItems() {
    return { data: await this.service.listItemTypes() };
  }

  @Post('items')
  @Permissions('lookups.manage')
  async createItem(@Body() dto: CreateAllocationItemTypeDto) {
    return { data: await this.service.createItemType(dto) };
  }

  @Patch('items/:itemId')
  @Permissions('lookups.manage')
  async updateItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateAllocationItemTypeDto,
  ) {
    return { data: await this.service.updateItemType(itemId, dto) };
  }

  @Delete('items/:itemId')
  @Permissions('lookups.manage')
  async deleteItem(@Param('itemId', ParseUUIDPipe) itemId: string) {
    await this.service.deleteItemType(itemId);
    return { message: 'Item removed' };
  }
}
