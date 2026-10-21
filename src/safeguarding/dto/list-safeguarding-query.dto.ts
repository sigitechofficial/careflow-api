import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  SafeguardingCategory,
  SafeguardingRisk,
  SafeguardingStatus,
} from '@prisma/client';

export class ListSafeguardingQueryDto {
  @ApiPropertyOptional({ enum: SafeguardingStatus })
  @IsOptional()
  @IsEnum(SafeguardingStatus)
  status?: SafeguardingStatus;

  @ApiPropertyOptional({ enum: SafeguardingCategory })
  @IsOptional()
  @IsEnum(SafeguardingCategory)
  category?: SafeguardingCategory;

  @ApiPropertyOptional({ enum: SafeguardingRisk })
  @IsOptional()
  @IsEnum(SafeguardingRisk)
  riskLevel?: SafeguardingRisk;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  aboutServiceUserId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Header branch filter.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
