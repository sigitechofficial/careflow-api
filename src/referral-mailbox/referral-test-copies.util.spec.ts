import {
  mayGetCopy,
  referralTestCopyAddresses,
} from './referral-test-copies.util';

describe('referral test copies', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('reads REFERRAL_TEST_COPY_TO outside production (trimmed, lower-case, valid, unique)', () => {
    process.env.NODE_ENV = 'development';
    process.env.REFERRAL_TEST_COPY_TO =
      ' Tester@Gmail.com, not-an-email ,tester@gmail.com,b@x.test';
    expect(referralTestCopyAddresses()).toEqual([
      'tester@gmail.com',
      'b@x.test',
    ]);
  });

  it('while testing, copies go only to our own addresses, the mailbox and the testers', () => {
    process.env.NODE_ENV = 'development';
    process.env.REFERRAL_TEST_COPY_TO = 'tester@gmail.com';
    expect(mayGetCopy('manager@allforcare.co.uk')).toBe(true);
    expect(mayGetCopy('Tester@gmail.com')).toBe(true);
    expect(mayGetCopy('referrals@inbox.test', 'referrals@inbox.test')).toBe(
      true,
    );
    expect(mayGetCopy('someone@council.gov.uk')).toBe(false);
  });

  it('in production the tester list is ignored and the normal copy rules apply', () => {
    process.env.NODE_ENV = 'production';
    process.env.REFERRAL_TEST_COPY_TO = 'tester@gmail.com';
    expect(referralTestCopyAddresses()).toEqual([]);
    expect(mayGetCopy('someone@council.gov.uk')).toBe(true);
  });
});
