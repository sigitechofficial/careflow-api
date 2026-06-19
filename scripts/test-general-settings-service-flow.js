"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';
function mapRow(row) {
    return {
        wellbeingLabels: [
            row.wellbeingLabel1,
            row.wellbeingLabel2,
            row.wellbeingLabel3,
            row.wellbeingLabel4,
            row.wellbeingLabel5,
        ],
        enhancedRegularActionChecks: row.enhancedRegularActionChecks,
        allocateEmployeeBy: row.allocateEmployeeBy,
        updatedAt: row.updatedAt.toISOString(),
    };
}
async function main() {
    const user = await prisma.user.findFirst({
        where: { email: 'admin@careadmin.local', deletedAt: null },
        select: { id: true },
    });
    if (!user)
        throw new Error('no admin user');
    const dto = {
        enhancedRegularActionChecks: true,
        showRegularActionsInDailyList: true,
        allocateEmployeeBy: 'ZONE',
        shiftAccessMinutesBefore: 4,
        shiftAccessMinutesAfter: 3,
    };
    const row = await prisma.organisationGeneralSettings.update({
        where: { id: DEFAULT_SETTINGS_ID },
        data: {
            reviewCarePlanAfterDays: undefined,
            enhancedRegularActionChecks: dto.enhancedRegularActionChecks,
            showRegularActionsInDailyList: dto.showRegularActionsInDailyList,
            allocateEmployeeBy: dto.allocateEmployeeBy,
            shiftAccessMinutesBefore: dto.shiftAccessMinutesBefore,
            shiftAccessMinutesAfter: dto.shiftAccessMinutesAfter,
            updatedById: user.id,
        },
    });
    console.log('mapped', mapRow(row));
    await prisma.$disconnect();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=test-general-settings-service-flow.js.map