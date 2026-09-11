-- Unable-to-start (care not delivered after clock-in) as a first-class ECM exception.

ALTER TYPE "scheduling"."EcmExceptionKind" ADD VALUE IF NOT EXISTS 'UNABLE_TO_START';
