import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class UpdateComplianceRequirementDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  complianceTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workAreaId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobTitleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contractTypeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  blocksAllocation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  renewalBeforeDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
