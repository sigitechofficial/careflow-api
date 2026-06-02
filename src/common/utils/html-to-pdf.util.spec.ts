import { existsSync } from 'fs';
import { resolveChromiumExecutable } from './html-to-pdf.util';

describe('resolveChromiumExecutable', () => {
  it('returns configured path when PUPPETEER_EXECUTABLE_PATH exists', () => {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      expect(() => resolveChromiumExecutable()).toThrow(/PUPPETEER_EXECUTABLE_PATH/);
      return;
    }
    const prev = process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.PUPPETEER_EXECUTABLE_PATH = found;
    try {
      expect(resolveChromiumExecutable()).toBe(found);
    } finally {
      if (prev === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
      else process.env.PUPPETEER_EXECUTABLE_PATH = prev;
    }
  });
});
