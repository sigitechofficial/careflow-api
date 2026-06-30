import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ServiceUserVisitTaskItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  taskCatalogueTaskId!: string;

  @ApiPropertyOptional({ description: 'Instructions for the carer when completing this task' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  carerInstructions?: string | null;
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
