import { LearningContentType } from '@prisma/client';
import {
  assertLearningFileUpload,
  fileFitsContentType,
  isHttpsUrl,
  resolveLearningFilePath,
  signedLearningFileUrl,
  verifyLearningFileSignature,
} from './learning-file.util';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = Buffer.from('%PDF-1.7 test');

describe('learning-file.util', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_TOKEN_SECRET =
      process.env.JWT_ACCESS_TOKEN_SECRET || 'test-secret';
  });

  it('accepts a real PNG and PDF', () => {
    expect(
      assertLearningFileUpload({
        originalname: 'a.png',
        mimetype: 'image/png',
        size: PNG.length,
        buffer: PNG,
      }).kind,
    ).toBe('IMAGE');
    expect(
      assertLearningFileUpload({
        originalname: 'a.pdf',
        mimetype: 'application/pdf',
        size: PDF.length,
        buffer: PDF,
      }).kind,
    ).toBe('PDF');
  });

  it('rejects a file whose bytes do not match its type, or a type not allowed', () => {
    expect(() =>
      assertLearningFileUpload({
        originalname: 'a.png',
        mimetype: 'image/png',
        size: PDF.length,
        buffer: PDF,
      }),
    ).toThrow();
    expect(() =>
      assertLearningFileUpload({
        originalname: 'a.exe',
        mimetype: 'application/octet-stream',
        size: 3,
        buffer: Buffer.from('abc'),
      }),
    ).toThrow();
    expect(() =>
      assertLearningFileUpload({
        originalname: 'a.png',
        mimetype: 'image/png',
        size: 0,
        buffer: Buffer.alloc(0),
      }),
    ).toThrow();
  });

  it('rejects files over the limit', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    expect(() =>
      assertLearningFileUpload({
        originalname: 'a.png',
        mimetype: 'image/png',
        size: big.length,
        buffer: big,
      }),
    ).toThrow();
  });

  it('matches files to lesson types', () => {
    expect(fileFitsContentType('image/png', LearningContentType.IMAGE)).toBe(
      true,
    );
    expect(
      fileFitsContentType('application/pdf', LearningContentType.IMAGE),
    ).toBe(false);
    expect(
      fileFitsContentType('application/pdf', LearningContentType.PDF),
    ).toBe(true);
    expect(
      fileFitsContentType('application/pdf', LearningContentType.DOCUMENT),
    ).toBe(true);
    expect(fileFitsContentType('image/png', LearningContentType.TEXT)).toBe(
      false,
    );
  });

  it('signs links that verify, and rejects tampered or expired ones', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const url = new URL(`http://x${signedLearningFileUrl(id)}`);
    const exp = url.searchParams.get('exp') ?? undefined;
    const sig = url.searchParams.get('sig') ?? undefined;
    expect(verifyLearningFileSignature(id, exp, sig)).toBe(true);
    expect(
      verifyLearningFileSignature(
        '22222222-2222-4222-8222-222222222222',
        exp,
        sig,
      ),
    ).toBe(false);
    expect(verifyLearningFileSignature(id, exp, `${sig}x`)).toBe(false);
    expect(verifyLearningFileSignature(id, exp, sig, Number(exp) + 1)).toBe(
      false,
    );
  });

  it('keeps stored paths inside the storage folder', () => {
    expect(
      resolveLearningFilePath('storage/learning-files/a.png'),
    ).not.toBeNull();
    expect(
      resolveLearningFilePath('storage/learning-files/../../etc/passwd'),
    ).toBeNull();
    expect(resolveLearningFilePath('/etc/passwd')).toBeNull();
  });

  it('only allows https video links', () => {
    expect(isHttpsUrl('https://youtu.be/abc')).toBe(true);
    expect(isHttpsUrl('http://youtu.be/abc')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
  });
});
