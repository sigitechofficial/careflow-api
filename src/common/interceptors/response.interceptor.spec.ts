import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { BadRequestException } from '@nestjs/common';

const SECRET_KEYS = ['passwordHash', 'refreshTokenHash', 'tokenHash', 'gatewayTestPasswordEnc', 'gatewayLivePasswordEnc'];

function userRow(id: string) {
  return {
    id,
    email: `${id}@example.test`,
    firstName: 'Sam',
    lastName: 'Carer',
    passwordHash: '$2b$10$leakleakleakleakleakle',
    refreshTokenHash: 'sha256:leak',
    isActive: true,
  };
}

async function run(result: unknown) {
  const handler: CallHandler = { handle: () => of(result) };
  return lastValueFrom(new ResponseInterceptor().intercept({} as ExecutionContext, handler));
}

function expectNoSecrets(body: unknown) {
  const json = JSON.stringify(body);
  for (const key of SECRET_KEYS) expect(json).not.toContain(`"${key}"`);
}

describe('ResponseInterceptor: secret stripping', () => {
  it('strips credential columns from a bare service result (e.g. an eMAR event with whole User rows)', async () => {
    const event = { id: 'ev-1', enteredBy: userRow('a'), createdBy: userRow('b'), managerReviewedBy: userRow('c') };
    const body = (await run(event)) as { success: boolean; data: typeof event };
    expectNoSecrets(body);
    expect(body.success).toBe(true);
    expect(body.data.enteredBy).toEqual({
      id: 'a',
      email: 'a@example.test',
      firstName: 'Sam',
      lastName: 'Carer',
      isActive: true,
    });
  });

  it('strips them from { data, meta } envelopes and already-wrapped { success } bodies', async () => {
    const paged = await run({ data: [{ reviewedBy: userRow('r') }], meta: { total: 1 } });
    expectNoSecrets(paged);
    expect(paged).toMatchObject({ success: true, meta: { total: 1 } });

    const wrapped = await run({ success: true, message: 'ok', data: { user: userRow('w') } });
    expectNoSecrets(wrapped);
    expect(wrapped).toMatchObject({ success: true, message: 'ok', data: { user: { id: 'w' } } });
  });

  it('strips portal account and payroll gateway secrets', async () => {
    const body = await run({
      portalAccount: { email: 'p@example.test', passwordHash: 'x', refreshTokenHash: 'y' },
      settings: { gatewayTestUserId: 'gw', gatewayTestPasswordEnc: 'c1', gatewayLivePasswordEnc: 'c2' },
      reset: { tokenHash: 'z' },
    });
    expectNoSecrets(body);
  });

  it('does not touch the tokens a login legitimately returns', async () => {
    const body = await run({ message: 'Login successful', data: { accessToken: 'a.b.c', refreshToken: 'd.e.f' } });
    expect(body).toEqual({
      success: true,
      message: 'Login successful',
      data: { accessToken: 'a.b.c', refreshToken: 'd.e.f' },
      meta: {},
    });
  });

  it('passes StreamableFile downloads through untouched', async () => {
    const file = new StreamableFile(Buffer.from('pdf'));
    expect(await run(file)).toBe(file);
  });
});

describe('HttpExceptionFilter: secret stripping', () => {
  it('strips credential columns that an error body echoes', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never;

    new HttpExceptionFilter().catch(
      new BadRequestException({ message: 'Allocation warnings', carers: [userRow('c')], warnings: [] }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expectNoSecrets(body);
    expect(body.carers[0]).toMatchObject({ id: 'c', firstName: 'Sam' });
  });
});
