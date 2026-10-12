import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PayCardsService } from './billing-cards.service';
import {
  BillingCardQueryDto,
  CreatePayCardDto,
  UpdatePayCardDto,
  AssignPayCardMatchingDto,
  UnassignPayCardEmployeeDto,
  UpsertEmployeeFunderPayAssignmentDto,
  UpdateEmployeeFunderPayAssignmentDto,
  ChangeEmployeePayCardDto,
  PreviewPayDto,
} from './dto/billing-cards.dto';

@ApiTags('Billing — Pay cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@Controller('billing/pay-cards')
export class PayCardsController {
  constructor(private readonly service: PayCardsService) {}

  @Get()
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'List carer pay cards' })
  list(@Query() query: BillingCardQueryDto) {
    return this.service.list(query);
  }

  @Get('resolve/:employeeId')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('billing.pay_cards.read')
  @ApiOperation({
    summary:
      'Resolve pay card for an employee. Optional funderId applies employee+funder override first.',
  })
  resolveForEmployee(
    @Param('employeeId') employeeId: string,
    @Query('funderId') funderId?: string,
  ) {
    return this.service.resolveForEmployee(employeeId, undefined, { funderId });
  }

  @Get('employee-funder-assignments/:employeeId')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'List employee+funder pay card overrides for a carer' })
  listEmployeeFunderAssignments(@Param('employeeId') employeeId: string) {
    return this.service.listEmployeeFunderAssignments(employeeId);
  }

  @Post('employee-funder-assignments')
  @PayrollScope({ kind: 'employee', source: 'body', key: 'employeeId' })
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Create or update employee+funder pay card override' })
  upsertEmployeeFunderAssignment(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpsertEmployeeFunderPayAssignmentDto,
    @Req() req: Request,
  ) {
    return this.service.upsertEmployeeFunderAssignment(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch('employee-funder-assignments/:id')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Update employee+funder pay card override' })
  updateEmployeeFunderAssignment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeFunderPayAssignmentDto,
    @Req() req: Request,
  ) {
    return this.service.updateEmployeeFunderAssignment(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete('employee-funder-assignments/:id')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Remove employee+funder pay card override' })
  removeEmployeeFunderAssignment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.removeEmployeeFunderAssignment(user.id, id, getRequestAuditMeta(req));
  }

  @Post('preview')
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Preview pay for a sample visit with the given rules (nothing is saved)' })
  previewPay(@Body() dto: PreviewPayDto) {
    return this.service.previewPay(dto);
  }

  @Get('employee-history/:employeeId')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: "Dated history of a carer's own pay card" })
  getEmployeeHistory(@Param('employeeId') employeeId: string) {
    return this.service.getEmployeePayCardHistory(employeeId);
  }

  @Post('employee-history/:employeeId/change')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: "Change a carer's pay card from a date (e.g. promotion)" })
  changeEmployeePayCard(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: ChangeEmployeePayCardDto,
  ) {
    return this.service.changeEmployeePayCard(user.id, employeeId, dto);
  }

  @Get(':id/assignment-preview')
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Preview how many carers match a pay card assignment' })
  assignmentPreview(@Param('id') id: string) {
    return this.service.getAssignmentPreview(id);
  }

  @Post(':id/assign-matching')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Bulk-assign pay card to matching carers (Birdie-style)' })
  assignMatching(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AssignPayCardMatchingDto,
    @Req() req: Request,
  ) {
    return this.service.assignToMatchingEmployees(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/unassign')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Unassign a single carer from this pay card' })
  unassignEmployee(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UnassignPayCardEmployeeDto,
    @Req() req: Request,
  ) {
    return this.service.unassignEmployee(user.id, id, dto.employeeId, getRequestAuditMeta(req));
  }

  @Get(':id/versions')
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Pay card rate history (all versions with their rules)' })
  listVersions(@Param('id') id: string) {
    return this.service.listVersions(id);
  }

  @Get(':id')
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Get pay card by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Create pay card' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePayCardDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Update pay card' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayCardDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Soft-delete pay card' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
