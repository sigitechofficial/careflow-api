import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ServiceUserOverCareReviewStatus } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
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

class OverCareReviewListQueryDto {
  @ApiPropertyOptional({
    enum: ServiceUserOverCareReviewStatus,
    default: 'PENDING',
  })
  @IsOptional()
  @IsIn(Object.values(ServiceUserOverCareReviewStatus))
  status?: ServiceUserOverCareReviewStatus;
}

class OverCareCancelVisitsDto {
  @ApiProperty({
    type: [String],
    description: 'Future rota visits (scheduled job ids) to cancel.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  scheduledJobIds!: string[];

  @ApiPropertyOptional({
    description: 'Added to the reason on each cancelled visit.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

class OverCareNoActionDto {
  @ApiProperty({ description: 'Why nothing is cancelled (required).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
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
      'Over care in a week, its review status and the visits cancelled for it',
  })
  async overCareForWeek(
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Query() query: OverCareWeekQueryDto,
  ) {
    return {
      data: await this.overCare.forWeek(serviceUserId, query.weekStart),
    };
  }

  @Get('over-care-reviews')
  @AnyPermission('hours_approvals.read', 'hours_approvals.manage')
  @ApiOperation({
    summary:
      'Over care reviews (Workforce): one tab with the counts of all tabs',
  })
  async listReviews(@Query() query: OverCareReviewListQueryDto) {
    return {
      data: await this.overCare.listReviews(
        query.status ?? ServiceUserOverCareReviewStatus.PENDING,
      ),
    };
  }

  @Get('over-care-reviews/:id')
  @AnyPermission('hours_approvals.read', 'hours_approvals.manage')
  @ApiOperation({
    summary:
      'One over care review: the week, its visits, and (pending) future visits to cancel with what to check',
  })
  async getReview(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.overCare.getReview(id) };
  }

  @Post('over-care-reviews/:id/cancel-visits')
  @AnyPermission('hours_approvals.manage')
  @ApiOperation({
    summary:
      'Action taken: cancel the chosen future visits (no charge, carers notified)',
  })
  async cancelVisits(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: OverCareCancelVisitsDto,
  ) {
    return {
      data: await this.overCare.cancelVisits(id, user.id, {
        scheduledJobIds: dto.scheduledJobIds,
        note: dto.note,
      }),
    };
  }

  @Post('over-care-reviews/:id/no-action')
  @AnyPermission('hours_approvals.manage')
  @ApiOperation({ summary: 'No action needed: close the review with a reason' })
  async markNoAction(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: OverCareNoActionDto,
  ) {
    return {
      data: await this.overCare.markNoActionNeeded(id, user.id, dto.reason),
    };
  }
}
