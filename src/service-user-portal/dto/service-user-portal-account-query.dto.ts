import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const PORTAL_ACCOUNT_STATUS_FILTERS = [
  'all',
  'configured',
  'not_configured',
  'enabled',
  'disabled',
] as const;

export type PortalAccountStatusFilter = (typeof PORTAL_ACCOUNT_STATUS_FILTERS)[number];

export class ServiceUserPortalAccountQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search service user name, email, or portal login email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: PORTAL_ACCOUNT_STATUS_FILTERS,
    default: 'all',
    description: 'Filter by portal provisioning / enabled state',
  })
  @IsOptional()
  @IsIn([...PORTAL_ACCOUNT_STATUS_FILTERS])
  portalStatus?: PortalAccountStatusFilter = 'all';
}
