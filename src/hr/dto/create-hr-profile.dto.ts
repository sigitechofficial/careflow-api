import { ApiPropertyOptional } from '@nestjs/swagger';
import { CareWorkforceCategory, EmployeeLifecycleStatus, HrDeploymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateHrProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preferredName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateOfBirth?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  profilePhoto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobTitleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contractTypeId?: string;

  @ApiPropertyOptional({ enum: CareWorkforceCategory })
  @IsOptional()
  @IsEnum(CareWorkforceCategory)
  careWorkforceCategory?: CareWorkforceCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  branchTeam?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchLocationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  employmentStartDate?: Date;

  @ApiPropertyOptional({ enum: EmployeeLifecycleStatus })
  @IsOptional()
  @IsEnum(EmployeeLifecycleStatus)
  employeeLifecycleStatus?: EmployeeLifecycleStatus;

  @ApiPropertyOptional({ enum: HrDeploymentStatus })
  @IsOptional()
  @IsEnum(HrDeploymentStatus)
  deploymentStatus?: HrDeploymentStatus;
}
