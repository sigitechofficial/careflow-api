import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class EnquiryNoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  note!: string;
}
