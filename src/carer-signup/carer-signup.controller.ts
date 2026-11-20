import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeAppAuthGuard } from '../employee-app/guards/employee-app-auth.guard';
import { CarerSignupService } from './carer-signup.service';
import {
  CarerDeletionDecisionDto,
  CarerDeletionRequestDto,
  CarerSignupDecisionDto,
  CarerSignupDto,
} from './dto/carer-signup.dto';

/** Care app: a carer's own sign-up (public). */
@ApiTags('Employee App Auth')
@Controller('employee-app/auth')
export class CarerSignupPublicController {
  constructor(private readonly signup: CarerSignupService) {}

  @Public()
  @Get('signup-branches')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Care app sign-up: branches to choose from, with map position when known' })
  branches() {
    return this.signup.signupBranches();
  }

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ApiOperation({ summary: 'Care app: make a carer account that waits for office approval' })
  create(@Body() dto: CarerSignupDto, @Req() req: Request) {
    return this.signup.signup(dto, req);
  }
}

/** Care app (signed in): ask for the account to be deleted. */
@ApiTags('Employee App')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/me/delete-request')
export class CarerDeletionRequestController {
  constructor(private readonly signup: CarerSignupService) {}

  @Get()
  @ApiOperation({ summary: 'The carer’s latest account delete request, if any' })
  mine(@CurrentUser() user: RequestUser) {
    return this.signup.myDeletionRequest(user.employeeId!);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask a manager to delete this Care app account' })
  request(@CurrentUser() user: RequestUser, @Body() dto: CarerDeletionRequestDto, @Req() req: Request) {
    return this.signup.requestDeletion(user.employeeId!, dto, req);
  }
}

/** Office: review a Care app sign-up or delete request from the staff record. */
@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/account-review')
export class CarerAccountReviewController {
  constructor(private readonly signup: CarerSignupService) {}

  @Get()
  @Permissions('employees.read')
  @ApiOperation({ summary: 'How the staff record was made, and any waiting sign-up or delete request' })
  review(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.signup.reviewFor(user, id);
  }

  @Post('signup')
  // Who may decide is checked in the service (review roles, or employees.update).
  @Permissions('employees.read')
  @ApiOperation({ summary: 'Approve or decline a Care app sign-up' })
  decideSignup(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CarerSignupDecisionDto,
    @Req() req: Request,
  ) {
    return this.signup.decideSignup(user, id, dto, getRequestAuditMeta(req));
  }

  @Post('deletion')
  // Who may decide is checked in the service (review roles, or employees.delete).
  @Permissions('employees.read')
  @ApiOperation({ summary: 'Approve (deletes the account) or decline a carer’s delete request' })
  decideDeletion(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CarerDeletionDecisionDto,
    @Req() req: Request,
  ) {
    return this.signup.decideDeletion(user, id, dto, getRequestAuditMeta(req));
  }
}
