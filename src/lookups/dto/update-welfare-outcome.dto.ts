import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { WELFARE_OUTCOME_TONES } from './create-welfare-outcome.dto';

export class UpdateWelfareOutcomeDto {
  @ApiPropertyOptional({ example: 'seen-ok' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional({ example: 'Person seen — as expected' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label?: string;

  @ApiPropertyOptional({ enum: WELFARE_OUTCOME_TONES })
  @IsOptional()
  @IsIn(WELFARE_OUTCOME_TONES as unknown as string[])
  tone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
