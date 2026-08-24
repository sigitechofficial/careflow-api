import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import { CreateCandidateDocumentDto } from './dto/create-candidate-document.dto';
import { CandidatesService } from './candidates.service';

@Injectable()
export class CandidateDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatesService: CandidatesService,
  ) {}

  async list(user: RequestUser, candidateId: string) {
    await this.candidatesService.getById(user, candidateId);
    const docs = await this.prisma.candidateDocument.findMany({
      where: { candidateId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { data: docs };
  }

  async create(params: {
    user: RequestUser;
    candidateId: string;
    dto: CreateCandidateDocumentDto;
    file: Express.Multer.File;
    fileUrl: string;
  }) {
    await this.candidatesService.getById(params.user, params.candidateId);

    const created = await this.prisma.candidateDocument.create({
      data: {
        candidateId: params.candidateId,
        documentType: params.dto.documentType,
        fileUrl: params.fileUrl,
        fileName: params.file.filename,
        fileSize: params.file.size,
        mimeType: params.file.mimetype,
        reviewNotes: params.dto.reviewNotes,
        uploadedById: params.user.id,
        createdById: params.user.id,
      },
    });

    if (params.dto.documentType === 'CV') {
      await this.prisma.candidate.update({
        where: { id: params.candidateId },
        data: { cvFileUrl: params.fileUrl, updatedById: params.user.id },
      });
    }

    return { message: 'Candidate document uploaded', data: created };
  }

  async ensureCandidate(candidateId: string) {
    const c = await this.prisma.candidate.findFirst({
      where: { id: candidateId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Candidate not found');
    return c;
  }
}
