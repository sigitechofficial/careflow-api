import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeReviewsService } from './employee-reviews.service';
import { CreateEmployeeReviewDto, NextDuePreviewQueryDto } from './dto/create-employee-review.dto';
import { UpdateEmployeeReviewDto } from './dto/update-employee-review.dto';

@ApiTags('Employee Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-reviews')
export class EmployeeReviewsOverviewController {
  constructor(private readonly service: EmployeeReviewsService) {}

  @Get('overview')
  @Permissions('employees.read')
  overview() {
    return this.service.overview();
  }
}

@ApiTags('Employee Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/reviews')
export class EmployeeReviewsController {
  constructor(private readonly service: EmployeeReviewsService) {}

  @Get()
  @Permissions('employees.read')
  list(@Param('id') employeeId: string) {
    return this.service.list(employeeId);
  }

  /** Next due a review would get from its type's schedule and the carer's start date. */
  @Get('next-due')
  @Permissions('employees.read')
  nextDue(@Param('id') employeeId: string, @Query() query: NextDuePreviewQueryDto) {
    return this.service.previewNextDue(employeeId, query.reviewTypeId, query.lastDone ?? null);
  }

  @Post()
  @Permissions('employees.update')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Body() dto: CreateEmployeeReviewDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Patch(':reviewId')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: UpdateEmployeeReviewDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, reviewId, dto, getRequestAuditMeta(req));
  }

  @Delete(':reviewId')
  @Permissions('employees.update')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('reviewId') reviewId: string,
    @Query('reason') reason: string | undefined,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, employeeId, reviewId, reason, getRequestAuditMeta(req));
  }

  /** Who recorded and changed this review, when and why, and the supervision sessions held for it. */
  @Get(':reviewId/history')
  @Permissions('employees.read')
  history(@Param('id') employeeId: string, @Param('reviewId') reviewId: string) {
    return this.service.history(employeeId, reviewId);
  }
}
