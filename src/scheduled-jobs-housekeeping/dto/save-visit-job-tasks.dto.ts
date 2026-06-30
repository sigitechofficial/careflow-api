import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class SaveVisitJobTaskItemDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Planner assignment id (planned tasks)' })
  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Catalogue task id (extra / ad-hoc tasks)' })
  @IsOptional()
  @IsUUID()
  taskCatalogueTaskId?: string;

  @ApiPropertyOptional({ description: 'True when recording a task not planned for this round' })
  @IsOptional()
  @IsBoolean()
  isExtra?: boolean;

  @ApiProperty()
  @IsBoolean()
  isCompleted!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordedValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SaveVisitJobTasksDto {
  @ApiProperty({ type: [SaveVisitJobTaskItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveVisitJobTaskItemDto)
  tasks!: SaveVisitJobTaskItemDto[];
}
