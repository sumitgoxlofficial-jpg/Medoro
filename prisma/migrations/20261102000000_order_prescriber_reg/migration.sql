-- Schedule H1, X and NDPS orders carry the prescriber's registration number for the H1 register.
ALTER TABLE "DeliveryOrder" ADD COLUMN "prescriberReg" TEXT;
