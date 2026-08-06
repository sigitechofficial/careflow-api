import {
  assessRtiIdentityCompleteness,
  formatRtiIdentityBlockMessage,
  mapGenderNameToHmrc,
} from './payroll-rti-identity.util'

describe('payroll-rti-identity.util', () => {
  describe('mapGenderNameToHmrc', () => {
    it('maps Male/Female variants to M/F', () => {
      expect(mapGenderNameToHmrc('Male')).toBe('M')
      expect(mapGenderNameToHmrc('female')).toBe('F')
      expect(mapGenderNameToHmrc('M')).toBe('M')
      expect(mapGenderNameToHmrc('Other')).toBeNull()
      expect(mapGenderNameToHmrc(null)).toBeNull()
    })
  })

  describe('assessRtiIdentityCompleteness', () => {
    const complete = {
      firstName: 'Jane',
      lastName: 'Carer',
      dateOfBirth: '1990-01-15',
      genderName: 'Female',
      addressLine1: '1 High Street',
      town: 'Leeds',
      postcode: 'LS1 1AA',
      nationalInsuranceNo: 'QQ123456C',
      payrollNumber: 'PAY-001',
      taxCode: '1257L',
      niCategory: 'A',
    }

    it('passes when all FPS identity fields are present', () => {
      const result = assessRtiIdentityCompleteness(complete)
      expect(result.isComplete).toBe(true)
      expect(result.issues).toEqual([])
      expect(result.genderHmrc).toBe('F')
    })

    it('lists missing identity and profile fields', () => {
      const result = assessRtiIdentityCompleteness({
        firstName: 'Jane',
        lastName: '',
        genderName: 'Other',
      })
      expect(result.isComplete).toBe(false)
      expect(result.issues.length).toBeGreaterThan(3)
      expect(result.issues.some((i) => /last name/i.test(i))).toBe(true)
      expect(result.issues.some((i) => /Male or Female/i.test(i))).toBe(true)
    })

    it('formats a READY block message', () => {
      const msg = formatRtiIdentityBlockMessage(['Payroll number is missing'])
      expect(msg).toContain('Cannot set profile to READY')
      expect(msg).toContain('Payroll number is missing')
    })
  })
})
