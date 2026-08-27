import { formatMarApplyOn, indexMarBodyMapSites } from './employee-app-mar-body-map-site.util';

describe('formatMarApplyOn', () => {
  it('joins side and body part', () => {
    expect(formatMarApplyOn({ bodyPart: 'Upper arm', side: 'RIGHT' })).toBe('Right upper arm');
  });

  it('does not duplicate side already in the part name', () => {
    expect(formatMarApplyOn({ bodyPart: 'Right upper arm', side: 'RIGHT' })).toBe(
      'Right upper arm',
    );
  });
});

describe('indexMarBodyMapSites', () => {
  it('keeps the first (newest) site per medication', () => {
    const map = indexMarBodyMapSites([
      {
        serviceUserMedicationId: 'm1',
        bodyMapRecord: {
          id: 'r1',
          subType: 'Cream application',
          markers: [
            {
              bodyView: 'FRONT',
              bodyPart: 'Upper arm',
              side: 'RIGHT',
              specificLocation: 'Front · Upper arm',
              xCoordinate: 20.3,
              yCoordinate: 26.5,
            },
          ],
        },
      },
    ]);
    expect(map.get('m1')?.applyOn).toBe('Right upper arm');
    expect(map.get('m1')?.subType).toBe('Cream application');
    expect(map.get('m1')?.recordView).toBe('front');
    expect(map.get('m1')?.canvasView).toBe('dual');
    expect(map.get('m1')?.x).toBe(20.3);
    expect(map.get('m1')?.y).toBe(26.5);
  });
});
