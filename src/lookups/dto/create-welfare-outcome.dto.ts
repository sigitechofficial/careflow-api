import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const WELFARE_OUTCOME_TONES = ['ok', 'warn', 'bad'] as const;

export class CreateWelfareOutcomeDto {
  @ApiProperty({ example: 'seen-ok' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Person seen — as expected' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;

  @ApiPropertyOptional({ enum: WELFARE_OUTCOME_TONES, default: 'ok' })
  @IsOptional()
  @IsIn(WELFARE_OUTCOME_TONES as unknown as string[])
  tone?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
