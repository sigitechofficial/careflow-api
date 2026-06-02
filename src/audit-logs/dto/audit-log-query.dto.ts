import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditEventType, AuditStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter rows tied to a service user (metadata or medication records)' })
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  module?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    enum: AuditEventType,
    description: 'Enterprise event category (VIEW, CREATE, UPDATE, DELETE, EXPORT, SECURITY, SYSTEM)',
  })
  @IsOptional()
  @IsEnum(AuditEventType)
  eventType?: AuditEventType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordId?: string;

  @ApiPropertyOptional({ enum: AuditStatus })
  @IsOptional()
  @IsEnum(AuditStatus)
  status?: AuditStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Partial match on stored IP address' })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: 'createdAt' | 'module' | 'action';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
