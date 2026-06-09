import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitPlanSlotCode } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SuggestVisitPlanCarersDto {
  @ApiProperty({ enum: VisitPlanSlotCode })
  @IsEnum(VisitPlanSlotCode)
  slotCode!: VisitPlanSlotCode;

  @ApiProperty({ type: [Number], description: '0=Sun … 6=Sat' })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @ApiProperty({ example: '07:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  plannedStartTime!: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  plannedEndTime!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  requiredCarers?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  linkedCarePlanFormIds?: string[];
}
