import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationReviewsService } from './medication-reviews.service';
import { CreateMedicationReviewDto } from './dto/create-medication-review.dto';
import { UpdateMedicationReviewDto } from './dto/update-medication-review.dto';
import { ApiSimpleDeleteResultDto } from '../common/dto/api-error-response.dto';
import { MedicationReviewDto } from './dto/medication-review-response.dto';

@ApiTags('Medication Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-reviews')
export class MedicationReviewsController {
  constructor(private readonly service: MedicationReviewsService) {}

  @Get()
  @AnyPermission('service_users.medications.reviews.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List medication reviews' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiOkResponse({ type: [MedicationReviewDto] })
  @ApiMedicationStandardResponses()
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.reviews.create', 'service_users.update')
  @ApiOperation({ summary: 'Create medication review' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiCreatedResponse({ type: MedicationReviewDto })
  @ApiMedicationStandardResponses()
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateMedicationReviewDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':reviewId')
  @AnyPermission('service_users.medications.reviews.update', 'service_users.update')
  @ApiOperation({ summary: 'Update medication review' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'reviewId', description: 'Review UUID' })
  @ApiOkResponse({ type: MedicationReviewDto })
  @ApiMedicationStandardResponses()
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: UpdateMedicationReviewDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, reviewId, dto, getRequestAuditMeta(req));
  }

  @Delete(':reviewId')
  @AnyPermission('service_users.medications.reviews.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Delete medication review' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'reviewId', description: 'Review UUID' })
  @ApiOkResponse({ type: ApiSimpleDeleteResultDto })
  @ApiMedicationStandardResponses()
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('reviewId') reviewId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, reviewId, getRequestAuditMeta(req));
  }
}
