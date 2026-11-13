import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { Public } from '../../../common/decorators/public.decorator';
import { ApplyForVacancyDto } from './dto/apply-for-vacancy.dto';
import { CareersService } from './careers.service';

/** Same folder as staff-uploaded candidate files, so the CV shows on the candidate page. */
const UPLOAD_ROOT = join(process.cwd(), 'uploads', 'recruitment', 'candidates');
const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
];

/** Careers page: no login. Anyone can see open jobs and apply. */
@ApiTags('Careers (public)')
@Controller('careers')
export class CareersController {
  constructor(private readonly careers: CareersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Open vacancies for the public careers page' })
  list() {
    return this.careers.listOpen();
  }

  @Public()
  @Get(':vacancyId')
  @ApiOperation({ summary: 'One open vacancy (404 once it is closed or paused)' })
  get(@Param('vacancyId') vacancyId: string) {
    return this.careers.getOpen(vacancyId);
  }

  @Public()
  @Post(':vacancyId/apply')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Apply for an open vacancy (optional CV up to 10 MB: PDF, Word, JPG or PNG)' })
  @UseInterceptors(
    FileInterceptor('cv', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(UPLOAD_ROOT)) mkdirSync(UPLOAD_ROOT, { recursive: true });
          cb(null, UPLOAD_ROOT);
        },
        filename: (_req, file, cb) => {
          cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname).toLowerCase()}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (CV_TYPES.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException('Upload your CV as a PDF, Word document, JPG or PNG.'), false);
      },
    }),
  )
  apply(
    @Param('vacancyId') vacancyId: string,
    @Body() dto: ApplyForVacancyDto,
    @UploadedFile() cv?: Express.Multer.File,
  ) {
    const fileUrl = cv ? `/uploads/recruitment/candidates/${cv.filename}` : null;
    return this.careers.apply(vacancyId, dto, cv, fileUrl);
  }
}
