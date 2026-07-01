import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const VISIT_TASK_PRIORITY_CODES = ['routine', 'important', 'critical'] as const;
export type VisitTaskPriorityCode = (typeof VISIT_TASK_PRIORITY_CODES)[number];

export class ServiceUserVisitTaskItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  taskCatalogueTaskId!: string;

  @ApiPropertyOptional({ description: 'Instructions for the carer when completing this task' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  carerInstructions?: string | null;

  @ApiPropertyOptional({
    enum: VISIT_TASK_PRIORITY_CODES,
    default: 'routine',
    description: 'Relative priority for this task on the visit',
  })
  @IsOptional()
  @IsIn(VISIT_TASK_PRIORITY_CODES)
  priority?: VisitTaskPriorityCode;
}

export class ServiceUserVisitTaskRoundDto {
  @ApiProperty({ example: 'MORNING' })
  @IsString()
  medicationRoundCode!: string;

  @ApiProperty({ type: [ServiceUserVisitTaskItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceUserVisitTaskItemDto)
  tasks!: ServiceUserVisitTaskItemDto[];
}

export class ReplaceServiceUserVisitTasksDto {
  @ApiProperty({ type: [ServiceUserVisitTaskRoundDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceUserVisitTaskRoundDto)
  rounds!: ServiceUserVisitTaskRoundDto[];
}
