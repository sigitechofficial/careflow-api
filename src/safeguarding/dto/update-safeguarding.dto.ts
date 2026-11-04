import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateSafeguardingDto } from './create-safeguarding.dto';

/**
 * All create fields optional, plus the referral/outcome fields that are filled
 * in as the case progresses. Status changes go through the transition endpoint.
 */
export class UpdateSafeguardingDto extends PartialType(CreateSafeguardingDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  laReference?: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsString()
  laReferredAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cqcReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  outcome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  lessonsLearned?: string;
}
