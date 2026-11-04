import { ForbiddenException } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { InitialAssessmentConversationFilesService } from './initial-assessment-conversation-files.service';

describe('InitialAssessmentConversationFilesService', () => {
  const base = join('tmp', `ia-conversation-spec-${process.pid}`);
  const tempDir = join(process.cwd(), base, 'incoming');
  const previousBase = process.env.UPLOAD_BASE_PATH;
  const audit = { logAudit: jest.fn() };
  const prisma: any = {
    initialAssessmentSubmission: { findFirst: jest.fn() },
    initialAssessmentAttachment: {
      create: jest.fn(({ data }) =>
        Promise.resolve({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      findFirst: jest.fn(),
    },
  };
  const service = new InitialAssessmentConversationFilesService(
    prisma,
    audit as never,
  );

  const upload = (name = 'visit.webm'): Express.Multer.File => {
    const path = join(tempDir, `${Date.now()}-${name}`);
    writeFileSync(path, 'fake audio');
    return {
      path,
      originalname: name,
      mimetype: 'video/webm',
      size: 10,
    } as Express.Multer.File;
  };

  beforeAll(() => {
    process.env.UPLOAD_BASE_PATH = base;
    mkdirSync(tempDir, { recursive: true });
  });
  afterAll(() => {
    process.env.UPLOAD_BASE_PATH = previousBase;
    rmSync(join(process.cwd(), base), { recursive: true, force: true });
  });
  beforeEach(() => jest.clearAllMocks());

  it('keeps the recording privately as an attachment of the assessment and the service user', async () => {
    prisma.initialAssessmentSubmission.findFirst.mockResolvedValue({
      id: 's1',
      status: 'IN_PROGRESS',
      templateId: 't1',
    });
    const file = upload();
    const { attachment, path } = await service.saveRecording(
      'u1',
      'su1',
      's1',
      file,
    );

    expect(existsSync(file.path)).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('fake audio');
    expect(path).toContain(join('initial-assessment-conversations', 's1'));
    expect(attachment).toMatchObject({
      serviceUserId: 'su1',
      submissionId: 's1',
      category: 'CONVERSATION_RECORDING',
      mimeType: 'audio/webm',
      originalName: 'visit.webm',
    });
    // Never a static /uploads link: only the permission-checked endpoint serves it.
    expect(attachment.fileUrl).toBe(
      `/service-users/su1/initial-assessments/s1/attachments/${attachment.id}/file`,
    );
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'initial_assessment_attachment_uploaded',
      }),
    );
  });

  it('refuses a recording on a submitted assessment', async () => {
    prisma.initialAssessmentSubmission.findFirst.mockResolvedValue({
      id: 's1',
      status: 'SUBMITTED',
      templateId: 't1',
    });
    await expect(
      service.saveRecording('u1', 'su1', 's1', upload()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.initialAssessmentAttachment.create).not.toHaveBeenCalled();
  });

  it('saves the transcript as a .txt attachment and serves it back', async () => {
    prisma.initialAssessmentSubmission.findFirst.mockResolvedValue({
      templateId: 't1',
    });
    const row = await service.saveTranscript(
      'u1',
      'su1',
      's1',
      { id: 'r1', originalName: 'visit.webm' },
      'I live alone.',
    );
    expect(row).toMatchObject({
      category: 'CONVERSATION_TRANSCRIPT',
      originalName: 'visit-transcript.txt',
      fileSize: 13,
    });

    prisma.initialAssessmentAttachment.findFirst.mockResolvedValue(row);
    const file = await service.fileFor('u1', 'su1', 's1', row!.id);
    expect(readFileSync(file.path, 'utf8')).toBe('I live alone.');
    expect(audit.logAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'initial_assessment_attachment_downloaded',
      }),
    );
  });
});
