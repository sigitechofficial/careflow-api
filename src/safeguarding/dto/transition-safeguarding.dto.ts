import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { SafeguardingAction } from '../safeguarding-workflow.util';
import { SAFEGUARDING_ACTIONS } from '../safeguarding-workflow.util';

export class TransitionSafeguardingDto {
  @ApiProperty({ enum: SAFEGUARDING_ACTIONS })
  @IsIn(SAFEGUARDING_ACTIONS)
  action!: SafeguardingAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ description: 'Required when closing a case.' })
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
