import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { emptyToNull, emptyToUndefined } from '../../common/transforms/empty-to-null.util';

export class UpdateComplianceRequirementDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  complianceTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  roleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  workAreaId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  jobTitleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  contractTypeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  zoneId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

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
