import { payOverCharge } from './pay-over-charge.util';

describe('payOverCharge', () => {
  it('flags a visit whose carer pay is above its charge', () => {
    expect(payOverCharge(52.5, 48)).toEqual({ visitPay: 52.5, visitCharge: 48, shortfall: 4.5 });
  });

  it('flags pay on a visit charged £0', () => {
    expect(payOverCharge(21, 0)).toEqual({ visitPay: 21, visitCharge: 0, shortfall: 21 });
  });

  it('does not flag pay equal to or below the charge', () => {
    expect(payOverCharge(48, 48)).toBeNull();
    expect(payOverCharge(21, 48)).toBeNull();
  });

  it('ignores float noise below a penny', () => {
    expect(payOverCharge(0.1 + 0.2, 0.3)).toBeNull();
  });

  it('does not flag while the charge or pay is not priced', () => {
    expect(payOverCharge(21, null)).toBeNull();
    expect(payOverCharge(null, 48)).toBeNull();
  });
});
