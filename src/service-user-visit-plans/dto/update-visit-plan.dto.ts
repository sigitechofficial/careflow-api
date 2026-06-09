import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VisitPlanSlotDto } from './visit-plan-slot.dto';

export class UpdateVisitPlanDto {
  @ApiProperty({ description: 'Reason for this change (CQC amendment audit)' })
  @IsString()
  @MaxLength(2000)
  amendmentReason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  weeklyContractedHours?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  numberOfCarers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewDueAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ type: [VisitPlanSlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitPlanSlotDto)
  slots?: VisitPlanSlotDto[];
}
