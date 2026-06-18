import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { emptyToUndefined } from '../../common/transforms/empty-to-null.util';

export class CreateComplianceRequirementDto {
  @ApiProperty()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  complianceTypeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  workAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  jobTitleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  contractTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean = true;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 3650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  renewalBeforeDays?: number = 30;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
