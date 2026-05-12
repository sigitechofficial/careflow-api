import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class TemporaryInspectorLoginDto {
  @ApiProperty({ example: 'inspector_j_smith' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
