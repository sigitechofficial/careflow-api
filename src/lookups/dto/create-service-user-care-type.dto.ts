import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateServiceUserCareTypeDto {
  @ApiProperty({ example: 'Domiciliary Care' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'DOMICILIARY' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;
}
