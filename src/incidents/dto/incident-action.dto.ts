import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentActionPriority, IncidentActionStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateIncidentActionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @ApiPropertyOptional({
    enum: IncidentActionPriority,
    default: IncidentActionPriority.MEDIUM,
  })
  @IsOptional()
  @IsEnum(IncidentActionPriority)
  priority?: IncidentActionPriority;

  @ApiPropertyOptional({ description: 'Due date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Assigned employee id' })
  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @ApiPropertyOptional({
    description: 'Mandatory actions block High/Critical closure',
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}

export class UpdateIncidentActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @ApiPropertyOptional({ enum: IncidentActionPriority })
  @IsOptional()
  @IsEnum(IncidentActionPriority)
  priority?: IncidentActionPriority;

  @ApiPropertyOptional({ enum: IncidentActionStatus })
  @IsOptional()
  @IsEnum(IncidentActionStatus)
  status?: IncidentActionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}

export class CompleteIncidentActionDto {
  @ApiPropertyOptional({ description: 'Notes on how the action was completed' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  completionNotes?: string;
}
