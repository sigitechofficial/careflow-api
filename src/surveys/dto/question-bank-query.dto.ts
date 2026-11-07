import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BANK_AUDIENCES, BANK_TYPE_GROUPS, type BankAudience } from '../survey-library.service';

/** Question bank filters (all optional). */
export class QuestionBankQueryDto {
  @ApiPropertyOptional({ description: 'Searches the question, its help text and its answers' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: BANK_AUDIENCES, description: 'Who it is for (the ready-made survey group)' })
  @IsOptional()
  @IsIn([...BANK_AUDIENCES])
  audience?: BankAudience;

  @ApiPropertyOptional({ description: 'A section heading of the ready-made surveys' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @ApiPropertyOptional({ enum: Object.keys(BANK_TYPE_GROUPS), description: 'Answer type (TEXT = short and long text)' })
  @IsOptional()
  @IsIn(Object.keys(BANK_TYPE_GROUPS))
  type?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
