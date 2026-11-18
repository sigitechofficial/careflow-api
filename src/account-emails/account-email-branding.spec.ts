import { absoluteLogoUrl, careflowSiteUrl, loadAccountEmailBranding, loadBranchContact, setPasswordUrlBase } from './account-email-branding';

const profile = {
  displayName: 'Allfor Care Services Limited',
  companyName: 'Allfor Care Services Limited',
  legalName: 'ALLFOR CARE SERVICES LIMITED',
  companyNumber: '05142064',
  cqcProviderId: '1-101656545',
  companyWebsite: 'www.allforcare.co.uk',
  phoneNumber: '0208 930 3085',
  companyLogoUrl: '/uploads/company/logo.png',
  displayLogoUrl: null,
  registeredAddressLine1: '15 Maswell Park Road',
  registeredAddressLine2: null,
  registeredTown: 'Hounslow',
  registeredPostcode: 'TW3 2DL',
};

const db = (p: unknown) => ({ companyProfile: { findFirst: jest.fn().mockResolvedValue(p) } }) as never;

describe('account email branding', () => {
  it('reads the company, legal line, address and site from real settings', async () => {
    const b = await loadAccountEmailBranding(db(profile), {
      ADMIN_APP_URL: 'https://careflow.example.test/',
      API_PUBLIC_URL: 'https://api.example.test',
      NODE_ENV: 'production',
    });
    expect(b).toMatchObject({
      organisation: 'Allfor Care',
      logoUrl: 'https://api.example.test/uploads/company/logo.png',
      legalLine: 'ALLFOR CARE SERVICES LIMITED · Company no. 05142064 · CQC provider ID 1-101656545',
      addressLine: '15 Maswell Park Road, Hounslow TW3 2DL',
      website: 'https://www.allforcare.co.uk',
      siteUrl: 'https://careflow.example.test',
      setPasswordUrlBase: 'https://careflow.example.test',
      appStoreBadgeUrl: 'cid:careflow-app-store-badge',
    });
  });

  it('falls back to MAIL_LOGO_URL when Company Details has no usable logo', async () => {
    const b = await loadAccountEmailBranding(db({ ...profile, companyLogoUrl: '/uploads/company/logo.png' }), {
      ADMIN_APP_URL: 'https://careflow.example.test',
      MAIL_LOGO_URL: 'https://cdn.example.test/logo.png',
      NODE_ENV: 'production',
    });
    expect(b?.logoUrl).toBe('https://cdn.example.test/logo.png');
  });

  it('has no site in production without ADMIN_APP_URL / PASSWORD_RESET_URL_BASE', async () => {
    expect(await loadAccountEmailBranding(db(profile), { NODE_ENV: 'production' })).toBeNull();
    expect(careflowSiteUrl({ NODE_ENV: 'development' })).toBe('http://localhost:5173');
    expect(setPasswordUrlBase({ PASSWORD_RESET_URL_BASE: 'https://reset.test/', ADMIN_APP_URL: 'https://site.test' })).toBe('https://reset.test');
  });

  it('still works when the company profile can’t be read', async () => {
    const failing = { companyProfile: { findFirst: jest.fn().mockRejectedValue(new Error('db down')) } } as never;
    const b = await loadAccountEmailBranding(failing, { ADMIN_APP_URL: 'https://s.test' });
    expect(b).toMatchObject({ organisation: 'CareFlow', legalLine: null, siteUrl: 'https://s.test' });
  });

  it('logo paths: absolute URLs kept, /uploads via API_PUBLIC_URL, others dropped', () => {
    expect(absoluteLogoUrl('https://x.test/a.png', {})).toBe('https://x.test/a.png');
    expect(absoluteLogoUrl('/uploads/company/a.png', {})).toBeNull();
    expect(absoluteLogoUrl('/uploads/company/a.png', { API_PUBLIC_URL: 'https://api.test/' })).toBe('https://api.test/uploads/company/a.png');
    expect(absoluteLogoUrl('/etc/passwd', { API_PUBLIC_URL: 'https://api.test' })).toBeNull();
  });

  it('branch contact: the branch name and its phone', async () => {
    const prisma = {
      location: { findFirst: jest.fn().mockResolvedValue({ name: 'Allfor Care Hounslow' }) },
      scheduleArea: { findFirst: jest.fn().mockResolvedValue({ phone: ' 020 8898 2867 ' }) },
    } as never;
    expect(await loadBranchContact(prisma, 'loc-1')).toEqual({ name: 'Allfor Care Hounslow', phone: '020 8898 2867' });
    expect(await loadBranchContact(prisma, null)).toBeNull();
  });
});
