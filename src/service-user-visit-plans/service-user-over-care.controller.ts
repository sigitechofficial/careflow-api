import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { ServiceUserOverCareService } from './service-user-over-care.service';

class OverCareWeekQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-02',
    description: 'Any date in the over week (org timezone).',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart!: string;
}

@ApiTags('Service User Hours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-user-hours')
export class ServiceUserOverCareController {
  constructor(private readonly overCare: ServiceUserOverCareService) {}

  @Get('timebank/:serviceUserId/over-care')
  @AnyPermission('service_users.read')
  @ApiOperation({
    summary:
      "Over care in a week and the next week's visits it took back (or would take back)",
  })
  async overCareForWeek(
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Query() query: OverCareWeekQueryDto,
  ) {
    return {
      data: await this.overCare.forWeek(serviceUserId, query.weekStart),
    };
  }
}
