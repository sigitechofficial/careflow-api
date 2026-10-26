import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { FundingUsageService } from './funding-usage.service';
import { FundingUsageQueryDto } from './dto/funding-usage.dto';

@ApiTags('Billing — Funding usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@Controller('billing/service-users')
export class FundingUsageController {
  constructor(private readonly service: FundingUsageService) {}

  @Get(':serviceUserId/funding-usage')
  @PayrollScope({ kind: 'serviceUser', param: 'serviceUserId' })
  @Permissions('billing.visit_reconciliations.read')
  @ApiOperation({ summary: 'Carer pay, client charge and funding budget for a service user in a week or month' })
  forServiceUser(
    @Param('serviceUserId', new ParseUUIDPipe()) serviceUserId: string,
    @Query() query: FundingUsageQueryDto,
  ) {
    return this.service.forServiceUser(serviceUserId, query);
  }
}
