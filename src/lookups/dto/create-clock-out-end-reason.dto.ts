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
import { CLOCK_IN_ARRIVAL_KINDS } from './create-clock-in-arrival-reason.dto';

export class CreateClockOutEndReasonDto {
  @ApiProperty({ enum: CLOCK_IN_ARRIVAL_KINDS })
  @IsIn(CLOCK_IN_ARRIVAL_KINDS as unknown as string[])
  kind!: (typeof CLOCK_IN_ARRIVAL_KINDS)[number];

  @ApiProperty({ example: 'Client asked to finish early' })
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
