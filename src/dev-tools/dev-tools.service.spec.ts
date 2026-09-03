import { DevToolsService } from './dev-tools.service';
import type { IaApiAutofillService } from './ia-api-autofill.service';

const QA_SU_ID = '11111111-1111-4111-8111-111111111111';
const REAL_SU_ID = '22222222-2222-4222-8222-222222222222';

const generated = {
  answers: [{ questionId: 'q1', textValue: 'generated' }],
  metadata: { waterlow: { score: 18 } },
  profilePatch: {},
};

function makeService(opts?: { generateSection?: jest.Mock }) {
  const generateSection = opts?.generateSection ?? jest.fn().mockResolvedValue(generated);
  const iaApiAutofill = { generateSection } as unknown as IaApiAutofillService;
  return {
    service: new DevToolsService(iaApiAutofill),
    generateSection,
  };
}

describe('DevToolsService.generateIaSection', () => {
  it('returns generated values without persisting IA answers', async () => {
    const { service, generateSection } = makeService();

    const result = await service.generateIaSection('critical', 10, ['q1'], null, QA_SU_ID);

    expect(result).toEqual(generated);
    expect(generateSection).toHaveBeenCalledWith('critical', 10, ['q1'], null);
  });

  it('allows SU-1042 and a non-SU-1042 Service User equally (no number authorization)', async () => {
    const { service, generateSection } = makeService();

    await expect(
      service.generateIaSection('normal', 1, [], undefined, QA_SU_ID),
    ).resolves.toEqual(generated);
    await expect(
      service.generateIaSection('critical', 10, ['q1'], null, REAL_SU_ID),
    ).resolves.toEqual(generated);
    expect(generateSection).toHaveBeenCalledTimes(2);
  });

  it('allows generate when serviceUserId is omitted (id is not authorization)', async () => {
    const { service, generateSection } = makeService();
    await expect(service.generateIaSection('low', 5, [])).resolves.toEqual(generated);
    expect(generateSection).toHaveBeenCalledTimes(1);
  });
});
