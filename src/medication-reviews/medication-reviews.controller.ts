import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { MedicationReviewsService } from './medication-reviews.service';
import { CreateMedicationReviewDto } from './dto/create-medication-review.dto';
import { UpdateMedicationReviewDto } from './dto/update-medication-review.dto';

@ApiTags('Medication Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-reviews')
export class MedicationReviewsController {
  constructor(private readonly service: MedicationReviewsService) {}

  @Get()
  @AnyPermission('service_users.medications.reviews.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List medication reviews' })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.reviews.create', 'service_users.update')
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
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('reviewId') reviewId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, reviewId, getRequestAuditMeta(req));
  }
}
