import * as path from 'path';
import {
  detectThumbnailFormat,
  detectVideoFormat,
  resolveBodyMapVideoAbsolutePath,
  sanitizeVideoOriginalName,
  signedBodyMapVideoUrl,
  verifyBodyMapVideoSignature,
} from './body-map-video.util';

const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from(`ftyp${brand}`), Buffer.alloc(4)]);

describe('body-map-video.util', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_TOKEN_SECRET ??= 'test-secret';
  });

  it('detects MP4 / MOV / 3GP by the ftyp box; rejects anything else', () => {
    expect(detectVideoFormat(ftyp('isom'))).toEqual({ mimeType: 'video/mp4', ext: '.mp4' });
    expect(detectVideoFormat(ftyp('qt  '))).toEqual({ mimeType: 'video/quicktime', ext: '.mov' });
    expect(detectVideoFormat(ftyp('3gp4'))).toEqual({ mimeType: 'video/3gpp', ext: '.3gp' });
    expect(detectVideoFormat(Buffer.from('<html><body>not a video</body>'))).toBeNull();
    expect(detectVideoFormat(undefined)).toBeNull();
  });

  it('detects JPEG / PNG thumbnails', () => {
    expect(detectThumbnailFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))?.ext).toBe('.jpg');
    expect(detectThumbnailFormat(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))?.ext).toBe('.png');
    expect(detectThumbnailFormat(Buffer.from('GIF89a..'))).toBeNull();
  });

  it('cleans the display name', () => {
    expect(sanitizeVideoOriginalName('/storage/emulated/0/DCIM/Camera/VID_20261006_101500.mp4')).toBe(
      'VID_20261006_101500.mp4',
    );
    expect(sanitizeVideoOriginalName('a\u0000b\nc.mov')).toBe('abc.mov');
    expect(sanitizeVideoOriginalName('  ')).toBeNull();
    expect(sanitizeVideoOriginalName('x'.repeat(300))?.length).toBe(200);
  });

  it('only resolves paths inside the private video root', () => {
    expect(resolveBodyMapVideoAbsolutePath('storage/body-map-videos/r1/a.mp4')).toBe(
      path.resolve(process.cwd(), 'storage/body-map-videos/r1/a.mp4'),
    );
    expect(resolveBodyMapVideoAbsolutePath('storage/body-map-videos/../../.env')).toBeNull();
    expect(resolveBodyMapVideoAbsolutePath('uploads/a.mp4')).toBeNull();
  });

  it('signs links per video + kind and rejects expired / tampered ones', () => {
    const now = Date.UTC(2026, 9, 6, 10, 1, 0);
    const url = signedBodyMapVideoUrl('v1', 'video', now);
    const q = new URLSearchParams(url.split('?')[1]);
    const exp = q.get('exp')!;
    const sig = q.get('sig')!;
    expect(url.startsWith('/body-map/videos/v1/video?')).toBe(true);
    expect(verifyBodyMapVideoSignature('v1', 'video', exp, sig, now)).toBe(true);
    expect(verifyBodyMapVideoSignature('v1', 'thumbnail', exp, sig, now)).toBe(false);
    expect(verifyBodyMapVideoSignature('v2', 'video', exp, sig, now)).toBe(false);
    expect(verifyBodyMapVideoSignature('v1', 'video', String(Number(exp) + 1), sig, now)).toBe(false);
    expect(verifyBodyMapVideoSignature('v1', 'video', exp, sig, Number(exp) + 1)).toBe(false);
    expect(verifyBodyMapVideoSignature('v1', 'video', exp, undefined, now)).toBe(false);
    // Stable within the rounding window (browser can cache the file).
    expect(signedBodyMapVideoUrl('v1', 'video', now + 60_000)).toBe(url);
  });
});
