import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class UpdateDefaultFormSelectionDto {
  @ApiPropertyOptional({ type: [String], description: 'Care plan form IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  carePlans?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Assessment form IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assessments?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Service form IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  serviceForms?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Staff form IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  staffForms?: string[];
}
