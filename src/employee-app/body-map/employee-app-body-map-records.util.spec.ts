import {
  apiBodyViewToRecordView,
  bodyMapRecordToMobileMarker,
  enrichBodyMapRecordForMobile,
} from './employee-app-body-map-records.util';

describe('employee-app-body-map-records.util', () => {
  it('infers mobile marker from admin record without recordView in observationDetails', () => {
    const marker = bodyMapRecordToMobileMarker({
      markers: [
        {
          bodyView: 'FRONT',
          side: 'RIGHT',
          bodyPart: 'Forearm',
          specificLocation: 'Front · Forearm',
          xCoordinate: 13.7,
          yCoordinate: 42.7,
        },
      ],
      observationDetails: { channel: 'admin', scheduledJobId: 'job-1' },
    });
    expect(marker).toMatchObject({
      recordView: 'front',
      canvasView: 'dual',
      x: 13.7,
      y: 42.7,
      source: 'admin',
    });
  });

  it('preserves explicit recordView from carer wizard', () => {
    const enriched = enrichBodyMapRecordForMobile({
      id: 'r1',
      markers: [
        {
          bodyView: 'FRONT',
          side: 'RIGHT',
          bodyPart: 'Forearm',
          specificLocation: null,
          xCoordinate: 10,
          yCoordinate: 20,
        },
      ],
      observationDetails: {
        channel: 'employee_app',
        recordView: 'front',
        canvasView: 'dual',
        regionId: 'right-arm-lower-front',
      },
    });
    expect(enriched.mobileMarker?.regionId).toBe('right-arm-lower-front');
    expect(enriched.mobileMarker?.source).toBe('employee_app');
  });

  it('maps BACK body view to back record view', () => {
    expect(apiBodyViewToRecordView('BACK')).toBe('back');
  });
});
