import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IncidentPrivacyLevel,
  IncidentSeverity,
  IncidentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TransformOptionalBooleanQuery } from '../../common/transformers/optional-boolean-query.transform';
import { TransformStringArrayQuery } from '../../common/transformers/string-array-query.transform';

export class ListIncidentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: IncidentStatus })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @ApiPropertyOptional({ enum: IncidentSeverity })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @ApiPropertyOptional({
    enum: IncidentSeverity,
    isArray: true,
    description: 'Any of these severities (comma-separated or repeated)',
  })
  @IsOptional()
  @TransformStringArrayQuery()
  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(IncidentSeverity, { each: true })
  severities?: IncidentSeverity[];

  @ApiPropertyOptional({ enum: IncidentPrivacyLevel })
  @IsOptional()
  @IsEnum(IncidentPrivacyLevel)
  privacyLevel?: IncidentPrivacyLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subtypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    enum: ['occurredAt', 'reportedAt'],
    default: 'occurredAt',
    description:
      'Which date dateFrom/dateTo and the newest-first sort use: when it happened, or when it was recorded',
  })
  @IsOptional()
  @IsIn(['occurredAt', 'reportedAt'])
  dateField?: 'occurredAt' | 'reportedAt';

  @ApiPropertyOptional({
    description: 'Filter by dateField from (YYYY-MM-DD, organisation timezone)',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      'Filter by dateField to, inclusive (YYYY-MM-DD, organisation timezone)',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Only open (non-closed) incidents' })
  @IsOptional()
  @TransformOptionalBooleanQuery()
  @IsBoolean()
  openOnly?: boolean;

  @ApiPropertyOptional({ description: 'Include archived/voided incidents' })
  @IsOptional()
  @TransformOptionalBooleanQuery()
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}
