-- Office alert when a carer's clock-in answers are worrying (see EcmExceptionsService.raiseWelfareOnArrival).
ALTER TYPE scheduling."EcmExceptionKind" ADD VALUE IF NOT EXISTS 'WELFARE_ON_ARRIVAL';
