import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RoleTaskRecurrence } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateRoleTaskTemplateDto {
  @ApiProperty({ example: "Calculate this month's salaries" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({ description: 'Office-user role that owns the task' })
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Branch; null = all branches',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '/billing/payroll-runs',
    description: 'Admin page to open',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(/^\/[^\s]*$/, {
    message: 'link must be an app path starting with /',
  })
  @MaxLength(300)
  link?: string | null;

  @ApiProperty({ enum: RoleTaskRecurrence })
  @IsEnum(RoleTaskRecurrence)
  recurrence!: RoleTaskRecurrence;

  @ApiProperty({
    example: '2026-10-25',
    description: 'Due date (one-off) or first due date (repeating)',
  })
  @IsISO8601({ strict: true })
  startDate!: string;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 6,
    description: 'WEEKLY: 0 = Sunday … 6 = Saturday',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: 31,
    description: 'MONTHLY: day of the month',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRoleTaskTemplateDto extends PartialType(
  CreateRoleTaskTemplateDto,
) {}

export class UpdateRoleTaskStatusDto {
  @ApiProperty({ enum: ['OPEN', 'IN_PROGRESS', 'DONE'] })
  @IsIn(['OPEN', 'IN_PROGRESS', 'DONE'])
  status!: 'OPEN' | 'IN_PROGRESS' | 'DONE';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class ListRoleTasksQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'done', 'all'], default: 'open' })
  @IsOptional()
  @IsIn(['open', 'done', 'all'])
  status?: 'open' | 'done' | 'all';

  @ApiPropertyOptional({ description: 'Manager view: only this role' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
