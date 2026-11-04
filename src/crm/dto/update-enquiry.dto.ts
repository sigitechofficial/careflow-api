import { PartialType } from '@nestjs/swagger';
import { CreateEnquiryDto } from './create-enquiry.dto';

/** All create fields optional. Stage changes go through /move and /convert. */
export class UpdateEnquiryDto extends PartialType(CreateEnquiryDto) {}
