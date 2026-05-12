import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTemporaryInspectorDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Service user option ids from GET /temporary-inspectors/service-user-options; omit or empty array for all service users.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  serviceUserKeys?: string[];

  @ApiProperty({ example: '2026-05-12T09:00:00' })
  @IsDateString()
  validFrom!: string;

  @ApiProperty({ example: '2026-05-12T17:00:00' })
  @IsDateString()
  validTo!: string;
}
