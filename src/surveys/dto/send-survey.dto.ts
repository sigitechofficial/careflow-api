import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsUUID } from 'class-validator';

export class SendSurveyDto {
  @ApiPropertyOptional({
    description:
      'Employee ids to send to. Omit to target all active employees (employees-first MVP).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  employeeIds?: string[];
}
