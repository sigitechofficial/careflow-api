import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RecommendIncidentCarerCourseDto {
  @ApiPropertyOptional({
    description:
      'Employee to recommend the course to. Defaults to the incident primary employee when omitted.',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty({ description: 'Published learning course id' })
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ description: 'Optional due date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @ApiPropertyOptional({ description: 'Why this course is recommended' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Whether the assignment is mandatory', default: true })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}
