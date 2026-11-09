import {
  extractBodyMapPinsFromPayload,
  observationPayloadMatchesJob,
} from './employee-app-body-map-pins.util';

describe('employee-app-body-map-pins.util', () => {
  it('reads bodyMapPins from payload', () => {
    const pins = extractBodyMapPinsFromPayload({
      bodyMapPins: [{ view: 'dual', x: 10, y: 20, part: 'Chest' }],
    });
    // A dual-view pin keeps its canvas view and says which side of the body it was recorded on.
    expect(pins).toEqual([{ view: 'dual', x: 10, y: 20, part: 'Chest', canvasView: 'dual', recordView: 'front' }]);
  });

  it('filters observations by scheduledJobId when set', () => {
    expect(
      observationPayloadMatchesJob({ scheduledJobId: 'job-a' }, 'job-a'),
    ).toBe(true);
    expect(
      observationPayloadMatchesJob({ scheduledJobId: 'job-a' }, 'job-b'),
    ).toBe(false);
    expect(observationPayloadMatchesJob({}, 'job-a')).toBe(true);
  });
});
