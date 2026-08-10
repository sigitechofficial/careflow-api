/**
 * Idempotent: backfill employee HR + payroll fields required for UK FPS / RTI enrol.
 * Only fills values that are missing or invalid (e.g. bad NINO). Does not overwrite good data.
 *
 * Invoked from prisma/scripts/run-deploy-seeds.sh after setup-payroll-employees-ready.
 *
 * Manual: npm run setup:payroll-fps-employee-data
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

const DEFAULT_DOB = new Date('1998-03-07T00:00:00.000Z')
const DEFAULT_ADDRESS = '1 Demo Street'
const DEFAULT_TOWN = 'London'
const DEFAULT_POSTCODE = 'SW1A 1AA'
const DEFAULT_HOURS_BAND = 'C'
const DEFAULT_START_DATE = new Date('2024-01-01T00:00:00.000Z')

/** Same rule as payroll-fps-validation.util.ts */
function isValidUkNino(raw) {
  if (!raw) return false
  const nino = raw.replace(/\s+/g, '').toUpperCase()
  return /^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(nino)
}

function isValidUkPostcode(raw) {
  if (!raw) return false
  const pc = raw.replace(/\s+/g, '').toUpperCase()
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)
}

function hasText(value) {
  return Boolean(value && String(value).trim().length > 0)
}

function mapGenderNameToHmrc(genderName) {
  const raw = (genderName ?? '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'm' || raw === 'male' || raw === 'man') return 'M'
  if (raw === 'f' || raw === 'female' || raw === 'woman') return 'F'
  return null
}

/** Stable synthetic NINO for dev/fixture use (unique per slot index). */
function syntheticNino(slotIndex) {
  const num = 123456 + (slotIndex % 899999)
  const suffix = ['A', 'B', 'C', 'D'][slotIndex % 4]
  return `AB${String(num).padStart(6, '0')}${suffix}`
}

function payrollNumberForIndex(index) {
  return `PAY-${String(index + 1).padStart(4, '0')}`
}

async function main() {
  const genders = await prisma.gender.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  })
  const male = genders.find((g) => g.name?.trim().toLowerCase() === 'male')
  const female = genders.find((g) => g.name?.trim().toLowerCase() === 'female')
  if (!male || !female) {
    console.warn(
      'WARN setup-payroll-fps-employee-data: Male/Female gender lookups missing; gender backfill may be skipped.',
    )
  }

  const schedules = await prisma.payrollSchedule.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    orderBy: [{ frequency: 'asc' }, { name: 'asc' }],
    select: { id: true },
  })
  const preferredSchedule = schedules.find((s) => s) ?? null

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      personalDetail: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          genderId: true,
          addressLine1: true,
          town: true,
          postcode: true,
          gender: { select: { name: true } },
        },
      },
      employment: {
        select: {
          id: true,
          startDate: true,
          nationalInsuranceNo: true,
          payrollNumber: true,
          employeeNumber: true,
        },
      },
    },
  })

  const profiles = await prisma.employeePayrollProfile.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      employeeId: true,
      status: true,
      taxCode: true,
      niCategory: true,
      scheduleId: true,
      hoursNormallyWorked: true,
    },
  })
  const profileByEmployee = new Map(profiles.map((p) => [p.employeeId, p]))

  const usedNinos = new Set()
  for (const emp of employees) {
    const ni = emp.employment?.nationalInsuranceNo
    if (ni && isValidUkNino(ni)) {
      usedNinos.add(ni.replace(/\s+/g, '').toUpperCase())
    }
  }

  let personalUpdated = 0
  let employmentCreated = 0
  let employmentUpdated = 0
  let profileCreated = 0
  let profileUpdated = 0
  let skippedNoPersonal = 0
  const stillIncomplete = []

  for (let index = 0; index < employees.length; index += 1) {
    const emp = employees[index]
    const pd = emp.personalDetail
    if (!pd) {
      skippedNoPersonal += 1
      stillIncomplete.push({ employeeId: emp.id, reason: 'no personal detail row' })
      continue
    }

    const personalPatch = {}
    if (!pd.dateOfBirth) personalPatch.dateOfBirth = DEFAULT_DOB
    if (!hasText(pd.addressLine1)) personalPatch.addressLine1 = DEFAULT_ADDRESS
    if (!hasText(pd.town)) personalPatch.town = DEFAULT_TOWN
    if (!hasText(pd.postcode) || !isValidUkPostcode(pd.postcode)) {
      personalPatch.postcode = DEFAULT_POSTCODE
    }
    const hmrcGender = mapGenderNameToHmrc(pd.gender?.name)
    if (!hmrcGender && male && female) {
      personalPatch.genderId = index % 2 === 0 ? male.id : female.id
    }

    if (Object.keys(personalPatch).length > 0) {
      await prisma.employeePersonalDetail.update({
        where: { id: pd.id },
        data: personalPatch,
      })
      personalUpdated += 1
    }

    let employment = emp.employment
    if (!employment) {
      let nino = syntheticNino(index)
      while (usedNinos.has(nino)) {
        nino = syntheticNino(index + usedNinos.size + 1)
      }
      usedNinos.add(nino)
      employment = await prisma.employeeEmployment.create({
        data: {
          id: randomUUID(),
          employeeId: emp.id,
          startDate: DEFAULT_START_DATE,
          nationalInsuranceNo: nino,
          payrollNumber: payrollNumberForIndex(index),
          employeeNumber: payrollNumberForIndex(index),
        },
      })
      employmentCreated += 1
    } else {
      const empPatch = {}
      if (!employment.startDate) empPatch.startDate = DEFAULT_START_DATE
      if (!hasText(employment.nationalInsuranceNo) || !isValidUkNino(employment.nationalInsuranceNo)) {
        let nino = syntheticNino(index)
        while (usedNinos.has(nino)) {
          nino = syntheticNino(index + usedNinos.size + 1)
        }
        usedNinos.add(nino)
        empPatch.nationalInsuranceNo = nino
      }
      if (!hasText(employment.payrollNumber)) {
        empPatch.payrollNumber = payrollNumberForIndex(index)
      }
      if (!hasText(employment.employeeNumber)) {
        empPatch.employeeNumber = empPatch.payrollNumber ?? employment.payrollNumber ?? payrollNumberForIndex(index)
      }
      if (Object.keys(empPatch).length > 0) {
        await prisma.employeeEmployment.update({
          where: { id: employment.id },
          data: empPatch,
        })
        employmentUpdated += 1
      }
    }

    const existingProfile = profileByEmployee.get(emp.id)
    const hoursOk = ['A', 'B', 'C', 'D', 'E'].includes(existingProfile?.hoursNormallyWorked ?? '')

    if (existingProfile?.status === 'SUSPENDED') {
      // leave suspended profiles untouched
    } else if (existingProfile) {
      const profilePatch = {}
      if (!hasText(existingProfile.taxCode)) profilePatch.taxCode = '1257L'
      if (!existingProfile.niCategory) profilePatch.niCategory = 'A'
      if (!hoursOk) profilePatch.hoursNormallyWorked = DEFAULT_HOURS_BAND
      if (existingProfile.status !== 'READY') {
        profilePatch.status = 'READY'
        profilePatch.taxCodeWeek1Month1 = true
      }
      if (!existingProfile.scheduleId && preferredSchedule) {
        profilePatch.scheduleId = preferredSchedule.id
      }
      if (Object.keys(profilePatch).length > 0) {
        await prisma.employeePayrollProfile.update({
          where: { id: existingProfile.id },
          data: profilePatch,
        })
        profileUpdated += 1
      }
    } else if (preferredSchedule) {
      await prisma.employeePayrollProfile.create({
        data: {
          id: randomUUID(),
          employeeId: emp.id,
          scheduleId: preferredSchedule.id,
          status: 'READY',
          taxCode: '1257L',
          taxCodeWeek1Month1: true,
          niCategory: 'A',
          hoursNormallyWorked: DEFAULT_HOURS_BAND,
          starterDeclaration: 'UNKNOWN',
          deductionElections: [],
        },
      })
      profileCreated += 1
    }

    const refreshedPd = { ...pd, ...personalPatch }
    const refreshedGenderName =
      personalPatch.genderId != null
        ? index % 2 === 0
          ? 'Male'
          : 'Female'
        : pd.gender?.name
    const refreshedEmp = employment
    const prof = profileByEmployee.get(emp.id)
    const assessmentIssues = []
    if (!hasText(refreshedPd.firstName)) assessmentIssues.push('firstName')
    if (!hasText(refreshedPd.lastName)) assessmentIssues.push('lastName')
    if (!refreshedPd.dateOfBirth && !personalPatch.dateOfBirth) assessmentIssues.push('dob')
    if (!mapGenderNameToHmrc(refreshedGenderName)) assessmentIssues.push('gender')
    if (!hasText(refreshedPd.addressLine1) && !personalPatch.addressLine1) assessmentIssues.push('address')
    if (!hasText(refreshedPd.town) && !personalPatch.town) assessmentIssues.push('town')
    const pc = personalPatch.postcode ?? refreshedPd.postcode
    if (!hasText(pc) || !isValidUkPostcode(pc)) assessmentIssues.push('postcode')
    const ni = refreshedEmp?.nationalInsuranceNo
    if (!hasText(ni) || !isValidUkNino(ni)) assessmentIssues.push('nino')
    if (!hasText(refreshedEmp?.payrollNumber)) assessmentIssues.push('payrollNumber')
    if (!prof && !preferredSchedule) assessmentIssues.push('payrollProfile')
    if (assessmentIssues.length > 0) {
      stillIncomplete.push({
        employeeId: emp.id,
        name: `${pd.firstName} ${pd.lastName}`.trim(),
        missing: assessmentIssues,
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        employees: employees.length,
        personalUpdated,
        employmentCreated,
        employmentUpdated,
        profileCreated,
        profileUpdated,
        skippedNoPersonal,
        stillIncompleteCount: stillIncomplete.length,
        stillIncomplete: stillIncomplete.slice(0, 20),
      },
      null,
      2,
    ),
  )

  if (stillIncomplete.length > 0) {
    console.warn(
      'Some employees still lack FPS RTI fields (see stillIncomplete). Add an ACTIVE pay schedule or fix HR rows manually.',
    )
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
