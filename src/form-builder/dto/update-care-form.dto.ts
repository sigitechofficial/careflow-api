import { ApiPropertyOptional } from '@nestjs/swagger';
import { CarePathwayFormType } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CARE_PLAN_REVIEW_FREQUENCY_MONTHS } from '../../service-user-care-plans/care-plan-review-schedule';

export class UpdateCareFormDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: CarePathwayFormType })
  @IsOptional()
  @IsEnum(CarePathwayFormType)
  formType?: CarePathwayFormType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ description: 'Icon URL; pass null to clear' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pictureUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Care plan review interval in calendar months; pass null to clear',
    enum: CARE_PLAN_REVIEW_FREQUENCY_MONTHS,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @IsIn([...CARE_PLAN_REVIEW_FREQUENCY_MONTHS])
  reviewFrequencyMonths?: number | null;
}
