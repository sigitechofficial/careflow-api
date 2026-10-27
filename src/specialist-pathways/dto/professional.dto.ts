import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePathwayProfessionalDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'e.g. GP, Social worker, SALT', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  role!: string;

  @ApiPropertyOptional({ description: 'Practice, team or organisation' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organisation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdatePathwayProfessionalDto extends PartialType(CreatePathwayProfessionalDto) {}
