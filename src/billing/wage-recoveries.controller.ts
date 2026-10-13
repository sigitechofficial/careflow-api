import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectWageRecoveryDto {
  @ApiProperty({ description: 'Why the overpayment is not being recovered' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note!: string;
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

  @Post(':id/approve')
  @Permissions('billing.payroll_runs.approve')
  @ApiOperation({ summary: 'Authorise a recovery from wages, stating the authority for the deduction' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ApproveWageRecoveryDto,
    @Req() req: Request,
  ) {
    return this.service.approve(user.id, id, dto.authorityBasis, dto.note, getRequestAuditMeta(req));
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
