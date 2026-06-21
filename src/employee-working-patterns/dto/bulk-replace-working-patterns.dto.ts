import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class BulkWorkingPatternWeekDto {
  @ApiProperty({ enum: [1, 2], description: 'Week index within the cycle (1 = Week 1, 2 = Week 2)' })
  @IsInt()
  @Min(1)
  @Max(2)
  weekInCycle!: number;

  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkReplaceWorkingPatternsDto {
  @ApiPropertyOptional({ enum: [1, 2], default: 1, description: '1 = standard week; 2 = fortnight' })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2])
  cycleWeeks?: number;

  @ApiPropertyOptional({ description: 'ISO date — which calendar week is Week 1 (defaults to employment start)' })
  @IsOptional()
  @IsDateString()
  cycleAnchorDate?: string;

  @ApiProperty({ type: [BulkWorkingPatternWeekDto] })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => BulkWorkingPatternWeekDto)
  weeks!: BulkWorkingPatternWeekDto[];
}
