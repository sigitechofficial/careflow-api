import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateServiceUserNfcTagDto {
  @ApiProperty({
    description: 'Tag UID in hex (separators allowed), e.g. 04:A2:3B:1C:5D:80:00',
    example: '04A23B1C5D8000',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  uid!: string;

  @ApiProperty({ example: 'Main tag' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @ApiPropertyOptional({ example: 'Hallway, next to the light switch' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationNote?: string;
}
