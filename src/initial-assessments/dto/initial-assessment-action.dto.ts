import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InitialAssessmentActionPriority,
  InitialAssessmentActionStatus,
  InitialAssessmentActionType,
} from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateInitialAssessmentActionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiProperty({ enum: InitialAssessmentActionType })
  @IsEnum(InitialAssessmentActionType)
  actionType!: InitialAssessmentActionType;

  @ApiPropertyOptional({ enum: InitialAssessmentActionPriority })
  @IsOptional()
  @IsEnum(InitialAssessmentActionPriority)
  priority?: InitialAssessmentActionPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}

export class UpdateInitialAssessmentActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ enum: InitialAssessmentActionPriority })
  @IsOptional()
  @IsEnum(InitialAssessmentActionPriority)
  priority?: InitialAssessmentActionPriority;

  @ApiPropertyOptional({ enum: InitialAssessmentActionStatus })
  @IsOptional()
  @IsEnum(InitialAssessmentActionStatus)
  status?: InitialAssessmentActionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}
