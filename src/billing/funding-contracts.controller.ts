import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { FundingContractsService } from './funding-contracts.service';
import { FundingContractsQueryDto } from './dto/funding-contracts.dto';

@ApiTags('Billing — Funding contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/funding-contracts')
export class FundingContractsController {
  constructor(private readonly service: FundingContractsService) {}

  @Get()
  @Permissions('billing.funding_contracts.read')
  @ApiOperation({ summary: 'List service user funding contracts with billing readiness' })
  list(@Query() query: FundingContractsQueryDto) {
    return this.service.list(query);
  }

  @Get('summary')
  @Permissions('billing.funding_contracts.read')
  @ApiOperation({ summary: 'Funding contract readiness summary for billing dashboard' })
  summary(@Query('locationId') locationId?: string) {
    return this.service.getSummary(locationId);
  }
}
