import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { SupervisionActionOwner, SupervisionActionStatus } from '@prisma/client';

export class CreateSupervisionActionDto {
  @ApiProperty({ description: 'Carer the action is about (must attend the session).' })
  @IsUUID()
  employeeId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ enum: SupervisionActionOwner, default: SupervisionActionOwner.CARER })
  @IsOptional()
  @IsEnum(SupervisionActionOwner)
  owner?: SupervisionActionOwner;

  @ApiPropertyOptional({ description: 'Name when owner is OTHER or MANAGER.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;
}

/** Actions are follow-ups, so their status can change after the session is signed. */
export class UpdateSupervisionActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: SupervisionActionOwner })
  @IsOptional()
  @IsEnum(SupervisionActionOwner)
  owner?: SupervisionActionOwner;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date | null;

  @ApiPropertyOptional({ enum: SupervisionActionStatus })
  @IsOptional()
  @IsEnum(SupervisionActionStatus)
  status?: SupervisionActionStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  completedNote?: string | null;
}
