import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitInitialAssessmentDto {
  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  /** When true, allow submit without required fields / incomplete worksheets (safety rules still apply). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  skipIncompleteValidation?: boolean;
}
