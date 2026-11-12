import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OfficeTestAlertsService } from './office-test-alerts.service';

export class TriggerTestAlertsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  kinds!: string[];

  /** A visit to raise them on; default: a recent one (in progress if there is one). */
  @IsOptional()
  @IsUUID()
  scheduledJobId?: string;
}

const superAdminOnly = (user: RequestUser) => {
  if (!user.roles?.includes('Super Admin')) throw new ForbiddenException('Only a Super Admin can raise test alerts.');
};

/** Test office alerts: try SOS, visit and medication alerts on a real recent visit, sent only to yourself. */
@ApiTags('Test office alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('office-alerts/test')
export class OfficeTestAlertsController {
  constructor(private readonly service: OfficeTestAlertsService) {}

  @Get()
  @ApiOperation({ summary: 'The office alerts that can be tried' })
  catalogue(@CurrentUser() user: RequestUser) {
    superAdminOnly(user);
    return this.service.catalogue();
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Raise test alerts (marked [TEST], only to you) on a recent visit' })
  trigger(@CurrentUser() user: RequestUser, @Body() dto: TriggerTestAlertsDto) {
    superAdminOnly(user);
    return this.service.trigger(user.id, dto.kinds, dto.scheduledJobId);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove all test alerts' })
  clear(@CurrentUser() user: RequestUser) {
    superAdminOnly(user);
    return this.service.clear(user.id);
  }
}
