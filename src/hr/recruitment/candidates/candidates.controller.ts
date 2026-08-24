import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import type { Request } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { UpdateCandidateStageDto } from './dto/update-candidate-stage.dto';
import { CandidateQueryDto } from './dto/candidate-query.dto';
import { CreateCandidateDocumentDto } from './dto/create-candidate-document.dto';
import {
  CandidateConversionService,
  CandidatesService,
} from './candidates.service';
import { CandidateDocumentsService } from './candidate-documents.service';

const UPLOAD_ROOT = join(process.cwd(), 'uploads', 'recruitment', 'candidates');

function ensureUploadDir() {
  if (!existsSync(UPLOAD_ROOT)) mkdirSync(UPLOAD_ROOT, { recursive: true });
}

@ApiTags('HR Candidates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/candidates')
export class CandidatesController {
  constructor(
    private readonly candidatesService: CandidatesService,
    private readonly conversionService: CandidateConversionService,
    private readonly documentsService: CandidateDocumentsService,
  ) {}

  @Post()
  @Permissions('hr.candidates.create')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCandidateDto) {
    return this.candidatesService.create(user, dto);
  }

  @Get()
  @Permissions('hr.candidates.read')
  list(@CurrentUser() user: RequestUser, @Query() query: CandidateQueryDto) {
    return this.candidatesService.list(user, query);
  }

  @Get('pipeline')
  @Permissions('hr.candidates.read')
  pipeline(@CurrentUser() user: RequestUser, @Query('vacancyId') vacancyId?: string) {
    return this.candidatesService.listPipeline(user, vacancyId);
  }

  @Get(':id')
  @Permissions('hr.candidates.read')
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.candidatesService.getById(user, id);
  }

  @Patch(':id/stage')
  @Permissions('hr.candidates.update')
  updateStage(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCandidateStageDto,
  ) {
    return this.candidatesService.updateStage(user, id, dto);
  }

  @Post(':id/convert')
  @Permissions('hr.candidates.convert')
  convert(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.conversionService.convert(user, id);
  }

  @Get(':id/documents')
  @Permissions('hr.candidates.read')
  listDocuments(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.documentsService.list(user, id);
  }

  @Post(':id/documents')
  @Permissions('hr.candidates.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          ensureUploadDir();
          cb(null, UPLOAD_ROOT);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  uploadDocument(
    @CurrentUser() user: RequestUser,
    @Param('id') candidateId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const body = req.body as Record<string, string | undefined>;
    const dto: CreateCandidateDocumentDto = {
      documentType: body.documentType as CreateCandidateDocumentDto['documentType'],
      reviewNotes: body.reviewNotes,
    };
    const fileUrl = `/uploads/recruitment/candidates/${file.filename}`;
    return this.documentsService.create({
      user,
      candidateId,
      dto,
      file,
      fileUrl,
    });
  }
}
