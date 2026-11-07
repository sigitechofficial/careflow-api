import { join, resolve } from 'path';
import { safeUploadPath } from './upload-path.util';

describe('safeUploadPath', () => {
  const base = resolve('/srv/careflow/uploads');

  it('places a stored URL or relative path inside the uploads folder', () => {
    expect(safeUploadPath('/uploads/company/logo.png', base)).toBe(join(base, 'company', 'logo.png'));
    expect(safeUploadPath('service-users/doc.pdf', base)).toBe(join(base, 'service-users', 'doc.pdf'));
  });

  it('refuses anything that escapes the folder, is absolute, is empty or holds a NUL', () => {
    for (const bad of [
      '/uploads/../secrets.env',
      '../secrets.env',
      'company/../../etc/passwd',
      '/etc/passwd',
      'C:\Windows\win.ini',
      '..',
      '/uploads/',
      '',
      null,
      undefined,
      'company/logo.png\0.txt',
    ]) {
      expect(safeUploadPath(bad as string, base)).toBeNull();
    }
  });
});
