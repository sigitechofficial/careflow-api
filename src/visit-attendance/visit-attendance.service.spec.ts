import { BadRequestException } from '@nestjs/common';
import { VisitAttendanceService } from './visit-attendance.service';

describe('VisitAttendanceService.assertGeofencePolicy', () => {
  const service = new VisitAttendanceService({} as never);

  it('allows check-in inside the geofence', async () => {
    await expect(
      service.assertGeofencePolicy({
        outsideGeofence: false,
        restrictOutside: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('hard-blocks GPS when restrictOutside is on', async () => {
    await expect(
      service.assertGeofencePolicy({
        outsideGeofence: true,
        restrictOutside: true,
        outsideGeofenceReason: 'GPS_DRIFT',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a reason when GPS is outside and restrictOutside is off', async () => {
    await expect(
      service.assertGeofencePolicy({
        outsideGeofence: true,
        restrictOutside: false,
      }),
    ).rejects.toThrow('Provide a reason before checking in');
  });

  it('allows GPS outside when a reason is provided and restrictOutside is off', async () => {
    await expect(
      service.assertGeofencePolicy({
        outsideGeofence: true,
        restrictOutside: false,
        outsideGeofenceReason: 'Traffic / parking around the corner',
      }),
    ).resolves.toBeUndefined();
  });
});
