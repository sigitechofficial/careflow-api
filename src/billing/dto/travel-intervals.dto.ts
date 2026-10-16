import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TRAVEL_CATEGORIES, TRAVEL_EVIDENCE } from '../travel-interval.util';

export class RecordTravelIntervalDto {
  @ApiProperty({ description: 'The visit the journey or wait led to' })
  @IsUUID()
  toVisitReconciliationId!: string;

  @ApiProperty({ enum: TRAVEL_CATEGORIES })
  @IsIn(TRAVEL_CATEGORIES as unknown as string[])
  category!: string;

  @ApiProperty({ enum: TRAVEL_EVIDENCE, description: 'How the times are known' })
  @IsIn(TRAVEL_EVIDENCE as unknown as string[])
  evidence!: string;

  @ApiProperty()
  @IsDateString()
  startAt!: string;

  @ApiProperty()
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional({
    description: 'For a training journey, a journey to a cancelled visit or "other": whether it is paid',
  })
  @IsOptional()
  @IsBoolean()
  payable?: boolean;

  @ApiProperty({ description: 'What the time was and how it is known' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note!: string;
}

export class DecideTravelIntervalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectTravelIntervalDto {
  @ApiProperty({ description: 'Why the interval is rejected' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note!: string;
}
