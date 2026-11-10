import { BadRequestException } from '@nestjs/common';
import { assertNotRecordBackedAlert } from './medical-alerts.service';
import { assertNotCommunicationAdjustment } from './reasonable-adjustments.service';

describe('one record per fact: alerts and adjustments', () => {
  it('refuses DNACPR and allergy alerts (carers are warned from the real records)', () => {
    expect(() => assertNotRecordBackedAlert('DNACPR')).toThrow(BadRequestException);
    expect(() => assertNotRecordBackedAlert('ALLERGIES')).toThrow(BadRequestException);
    expect(() => assertNotRecordBackedAlert('DIABETES')).not.toThrow();
    expect(() => assertNotRecordBackedAlert(undefined)).not.toThrow();
  });
  it('refuses communication and sensory adjustments (recorded in Privacy)', () => {
    expect(() => assertNotCommunicationAdjustment('COMMUNICATION')).toThrow(BadRequestException);
    expect(() => assertNotCommunicationAdjustment('SENSORY')).toThrow(BadRequestException);
    expect(() => assertNotCommunicationAdjustment('PHYSICAL_ACCESS')).not.toThrow();
  });
});
