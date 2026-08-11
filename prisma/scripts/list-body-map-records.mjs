import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const rows = await p.bodyMapRecord.findMany({
  where: { isArchived: false },
  orderBy: { createdAt: 'desc' },
  take: 10,
  include: { markers: { take: 1 } },
});
console.log(
  JSON.stringify(
    rows.map((x) => ({
      id: x.id,
      serviceUserId: x.serviceUserId,
      recordType: x.recordType,
      observationDetails: x.observationDetails,
      marker: x.markers[0]
        ? {
            bodyPart: x.markers[0].bodyPart,
            bodyView: x.markers[0].bodyView,
            x: Number(x.markers[0].xCoordinate),
            y: Number(x.markers[0].yCoordinate),
          }
        : null,
    })),
    null,
    2,
  ),
);
await p.$disconnect();
