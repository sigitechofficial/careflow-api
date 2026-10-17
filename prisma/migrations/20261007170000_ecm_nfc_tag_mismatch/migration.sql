-- Wrong / unknown / lost NFC tag scanned at clock-in — shown to the office as an ECM exception.
ALTER TYPE "scheduling"."EcmExceptionKind" ADD VALUE IF NOT EXISTS 'NFC_TAG_MISMATCH' BEFORE 'OTHER';
