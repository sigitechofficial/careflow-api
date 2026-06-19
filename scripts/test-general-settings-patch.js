"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';
async function main() {
    try {
        const row = await prisma.organisationGeneralSettings.update({
            where: { id: DEFAULT_SETTINGS_ID },
            data: {
                enhancedRegularActionChecks: true,
                showRegularActionsInDailyList: true,
                allocateEmployeeBy: 'ZONE',
                shiftAccessMinutesBefore: 4,
                shiftAccessMinutesAfter: 3,
            },
        });
        console.log('OK', {
            allocateEmployeeBy: row.allocateEmployeeBy,
            shiftAccessMinutesBefore: row.shiftAccessMinutesBefore,
        });
    }
    catch (e) {
        console.error('FAIL', e);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
main();
//# sourceMappingURL=test-general-settings-patch.js.map