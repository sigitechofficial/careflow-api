import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VisitPlanSlotDto } from './visit-plan-slot.dto';

export class CreateVisitPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiProperty({ description: 'Weekly contracted hours (required)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  weeklyContractedHours!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  numberOfCarers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceSubmissionId?: string | null;

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
