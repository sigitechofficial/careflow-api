import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PolicyLibraryService } from './policy-library.service';

export class AdoptLibraryPoliciesDto {
  @ApiProperty({ type: [String], description: 'Ready-made policy ids to adopt as draft policies' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  policyIds!: string[];
}

@ApiTags('Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('policy-library')
export class PolicyLibraryController {
  constructor(private readonly service: PolicyLibraryService) {}

  @Get()
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Ready-made policies (researched for CQC home care) and whether each is adopted' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Permissions('policies.read')
  @ApiOperation({ summary: "A ready-made policy's full text, with the organisation's name filled in" })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Get('for-policy/:policyId')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'The ready-made policy a policy was adopted from, and whether a newer revision exists' })
  forPolicy(@Param('policyId', ParseUUIDPipe) policyId: string) {
    return this.service.forPolicy(policyId);
  }

  @Post('apply-update/:policyId')
  @Permissions('policies.update')
  @ApiOperation({ summary: "Put the latest ready-made revision into the policy's draft (a new major version if none)" })
  applyUpdate(@CurrentUser() user: RequestUser, @Param('policyId', ParseUUIDPipe) policyId: string, @Req() req: Request) {
    return this.service.applyUpdate(user, policyId, getRequestAuditMeta(req));
  }

  @Post('adopt')
  @Permissions('policies.create')
  @ApiOperation({ summary: "Adopt ready-made policies as the organisation's own draft policies" })
  adopt(@CurrentUser() user: RequestUser, @Body() dto: AdoptLibraryPoliciesDto, @Req() req: Request) {
    return this.service.adopt(user, dto.policyIds, getRequestAuditMeta(req));
  }
}
