import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'DateOrder', async: false })
export class DateOrderConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const [startKey, endKey] = args.constraints as [string, string];
    const obj = args.object as Record<string, unknown>;
    const start = obj[startKey];
    const end = obj[endKey];
    if (start == null || end == null) return true;
    const a = new Date(start as string).getTime();
    const b = new Date(end as string).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return true;
    return b >= a;
  }

  defaultMessage(args: ValidationArguments) {
    const [startKey, endKey] = args.constraints as [string, string];
    return `${endKey} must be on or after ${startKey}`;
  }
}

export function IsOnOrAfterDate(startProperty: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsOnOrAfterDate',
      target: object.constructor,
      propertyName,
      constraints: [startProperty, propertyName],
      options: validationOptions,
      validator: DateOrderConstraint,
    });
  };
}
