import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  assertPolicyUploadFile,
  copyStoredPolicyFile,
  deletePolicyVersionUploadDir,
  deleteStoredPolicyFile,
  newPolicyStorageRelativePath,
  POLICY_UPLOAD_MAX_BYTES,
  POLICY_UPLOAD_MIME,
  policyStoragePathBelongsToVersion,
  resolveSafePolicyPath,
  writeStoredPolicyFile,
} from './policy-upload.util';

const PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.from('1 0 obj\n<<>>\nendobj\n%%EOF\n'),
]);
const DOC = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(32, 1),
]);
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(32, 1),
]);

describe('policy-upload.util', () => {
  const previous = process.env.UPLOAD_BASE_PATH;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `policy-upload-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    process.env.UPLOAD_BASE_PATH = root;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.UPLOAD_BASE_PATH;
    else process.env.UPLOAD_BASE_PATH = previous;
  });

  it('accepts PDF, DOC, and DOCX when extension, MIME, and magic match', () => {
    expect(
      assertPolicyUploadFile({
        originalname: 'a.pdf',
        mimetype: POLICY_UPLOAD_MIME.pdf,
        size: PDF.length,
        buffer: PDF,
      }).kind.ext,
    ).toBe('.pdf');
    expect(
      assertPolicyUploadFile({
        originalname: 'a.doc',
        mimetype: POLICY_UPLOAD_MIME.doc,
        size: DOC.length,
        buffer: DOC,
      }).kind.ext,
    ).toBe('.doc');
    expect(
      assertPolicyUploadFile({
        originalname: 'a.docx',
        mimetype: POLICY_UPLOAD_MIME.docx,
        size: DOCX.length,
        buffer: DOCX,
      }).kind.ext,
    ).toBe('.docx');
  });

  it('rejects unsupported extension even with a matching MIME', () => {
    expect(() =>
      assertPolicyUploadFile({
        originalname: 'note.txt',
        mimetype: 'text/plain',
        size: PDF.length,
        buffer: PDF,
      }),
    ).toThrow('Unsupported file type');
  });

  it('rejects unsupported MIME even with a matching extension', () => {
    expect(() =>
      assertPolicyUploadFile({
        originalname: 'policy.pdf',
        mimetype: 'application/octet-stream',
        size: PDF.length,
        buffer: PDF,
      }),
    ).toThrow('Unsupported file type');
  });

  it('rejects empty and oversized files', () => {
    expect(() =>
      assertPolicyUploadFile({
        originalname: 'a.pdf',
        mimetype: POLICY_UPLOAD_MIME.pdf,
        size: 0,
        buffer: Buffer.alloc(0),
      }),
    ).toThrow('Empty file');
    const big = Buffer.concat([PDF, Buffer.alloc(POLICY_UPLOAD_MAX_BYTES)]);
    expect(() =>
      assertPolicyUploadFile({
        originalname: 'a.pdf',
        mimetype: POLICY_UPLOAD_MIME.pdf,
        size: big.length,
        buffer: big,
      }),
    ).toThrow('File too large');
  });

  it('rejects missing buffers and mismatched magic bytes', () => {
    expect(() => assertPolicyUploadFile(undefined)).toThrow('Malformed file');
    expect(() =>
      assertPolicyUploadFile({
        originalname: 'a.pdf',
        mimetype: POLICY_UPLOAD_MIME.pdf,
        size: 8,
        buffer: Buffer.from('not-a-pdf'),
      }),
    ).toThrow('Malformed file');
  });

  it('strips path segments from the original filename and never trusts it as storage', () => {
    const parsed = assertPolicyUploadFile({
      originalname: '../../etc/passwd.pdf',
      mimetype: POLICY_UPLOAD_MIME.pdf,
      size: PDF.length,
      buffer: PDF,
    });
    expect(parsed.originalName).toBe('passwd.pdf');
    const relative = newPolicyStorageRelativePath(
      'doc-1',
      'ver-1',
      parsed.kind.ext,
    );
    expect(relative).toMatch(/^doc-1\/ver-1\/[0-9a-f-]+\.pdf$/);
    expect(relative).not.toContain('passwd');
  });

  it('blocks path traversal when resolving stored files', () => {
    expect(() => resolveSafePolicyPath('../secret.pdf')).toThrow(
      'Invalid storage path',
    );
  });

  it('writes, copies, and deletes files under the policy root', () => {
    const first = newPolicyStorageRelativePath('d1', 'v1', '.pdf');
    const second = newPolicyStorageRelativePath('d1', 'v2', '.pdf');
    writeStoredPolicyFile(first, PDF);
    copyStoredPolicyFile(first, second);
    expect(readFileSync(resolveSafePolicyPath(second)).equals(PDF)).toBe(true);
    deleteStoredPolicyFile(first);
    expect(() => readFileSync(resolveSafePolicyPath(first))).toThrow();
    writeFileSync(join(root, 'outside.bin'), 'nope');
  });

  it('only treats paths under the expected policy/version directory as owned', () => {
    expect(policyStoragePathBelongsToVersion('d1/v1/file.pdf', 'd1', 'v1')).toBe(true);
    expect(policyStoragePathBelongsToVersion('d2/v1/file.pdf', 'd1', 'v1')).toBe(false);
    expect(policyStoragePathBelongsToVersion('../secret.pdf', 'd1', 'v1')).toBe(false);
    const first = newPolicyStorageRelativePath('d1', 'v1', '.pdf');
    writeStoredPolicyFile(first, PDF);
    const other = newPolicyStorageRelativePath('d2', 'v2', '.pdf');
    writeStoredPolicyFile(other, PDF);
    deletePolicyVersionUploadDir('d1', 'v1');
    expect(() => readFileSync(resolveSafePolicyPath(first))).toThrow();
    expect(readFileSync(resolveSafePolicyPath(other)).equals(PDF)).toBe(true);
  });
});
