import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  AllocationItemCategory,
  EmployeeAllocationStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAllocationItemTypeDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: AllocationItemCategory })
  @IsEnum(AllocationItemCategory)
  category!: AllocationItemCategory;

  @ApiPropertyOptional({
    description: 'Expected back when the employee leaves',
  })
  @IsOptional()
  @IsBoolean()
  returnable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class UpdateAllocationItemTypeDto extends PartialType(
  CreateAllocationItemTypeDto,
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateEmployeeAllocationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemTypeId!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity?: number;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  size?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    description: 'Serial / IMEI / asset tag',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;

  @ApiProperty({ description: 'When the item was handed over (ISO)' })
  @IsDateString()
  issuedAt!: string;

  @ApiPropertyOptional({ description: 'Return due date (ISO), if any' })
  @IsOptional()
  @IsDateString()
  expectedReturnAt?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateEmployeeAllocationDto extends PartialType(
  CreateEmployeeAllocationDto,
) {
  @ApiPropertyOptional({ enum: EmployeeAllocationStatus })
  @IsOptional()
  @IsEnum(EmployeeAllocationStatus)
  status?: EmployeeAllocationStatus;

  @ApiPropertyOptional({
    description: 'When it came back / was reported lost or damaged (ISO)',
  })
  @IsOptional()
  @IsDateString()
  returnedAt?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  returnNotes?: string;
}

export class EmployeeAllocationsRegistryQueryDto {
  @ApiPropertyOptional({ enum: EmployeeAllocationStatus })
  @IsOptional()
  @IsEnum(EmployeeAllocationStatus)
  status?: EmployeeAllocationStatus;

  @ApiPropertyOptional({ enum: AllocationItemCategory })
  @IsOptional()
  @IsEnum(AllocationItemCategory)
  category?: AllocationItemCategory;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemTypeId?: string;

  @ApiPropertyOptional({
    description: 'Employee name, serial number or notes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
