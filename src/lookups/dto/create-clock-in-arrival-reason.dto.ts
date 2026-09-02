import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const CLOCK_IN_ARRIVAL_KINDS = ['EARLY', 'LATE'] as const;

export class CreateClockInArrivalReasonDto {
  @ApiProperty({ enum: CLOCK_IN_ARRIVAL_KINDS })
  @IsIn(CLOCK_IN_ARRIVAL_KINDS as unknown as string[])
  kind!: (typeof CLOCK_IN_ARRIVAL_KINDS)[number];

  @ApiProperty({ example: 'Client requested earlier arrival' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresNotes?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
