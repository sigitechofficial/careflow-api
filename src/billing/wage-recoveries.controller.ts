import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { WageRecoveriesService } from './wage-recoveries.service';

export class ApproveWageRecoveryDto {
  @ApiProperty({ description: 'The contractual or legal authority for deducting this overpayment from wages' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  authorityBasis!: string;

  @ApiProperty({ description: 'Why this recovery is being authorised' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class RejectWageRecoveryDto {
  @ApiProperty({ description: 'Why the overpayment is not being recovered' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note!: string;
}

export class RecordRecoveryPolicyDto {
  @ApiProperty({ description: 'Where the employer’s approved recovery policy and its legal authority are recorded' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reference!: string;
}

@ApiTags('Billing — Wage recoveries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@PayrollScope({ kind: 'organisation' })
@Controller('billing/wage-recoveries')
export class WageRecoveriesController {
  constructor(private readonly service: WageRecoveriesService) {}

  @Get()
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Overpayments found by pay calculations, and whether their recovery is authorised' })
  list(@Query('status') status?: string, @Query('employeeId') employeeId?: string) {
    return this.service.list(status, employeeId);
  }

  @Get('policy')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Whether the employer has an approved recovery policy on record (none: nothing is deducted)' })
  policy() {
    return this.service.policy();
  }

  @Post('policy')
  @Permissions('billing.payroll_runs.approve')
  @ApiOperation({ summary: 'Record that the employer has an approved recovery policy, and where it is' })
  recordPolicy(@CurrentUser() user: RequestUser, @Body() dto: RecordRecoveryPolicyDto, @Req() req: Request) {
    return this.service.recordPolicy(user.id, dto.reference, getRequestAuditMeta(req));
  }

  @Post('policy/withdraw')
  @Permissions('billing.payroll_runs.approve')
  @ApiOperation({ summary: 'Withdraw the recovery policy on record: nothing further is deducted' })
  withdrawPolicy(@CurrentUser() user: RequestUser, @Body() dto: RejectWageRecoveryDto, @Req() req: Request) {
    return this.service.withdrawPolicy(user.id, dto.note, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'One recovery with its history' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post(':id/approve')
  @Permissions('billing.payroll_runs.approve')
  @ApiOperation({ summary: 'Authorise a recovery from wages, stating the reason and the authority for the deduction' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ApproveWageRecoveryDto,
    @Req() req: Request,
  ) {
    return this.service.approve(user.id, id, dto.authorityBasis, dto.reason, getRequestAuditMeta(req));
  }

  @Post(':id/reject')
  @Permissions('billing.payroll_runs.approve')
  @ApiOperation({ summary: 'Reject a recovery: the overpayment is written off for that amount' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RejectWageRecoveryDto,
    @Req() req: Request,
  ) {
    return this.service.reject(user.id, id, dto.note, getRequestAuditMeta(req));
  }
}
