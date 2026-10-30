-- Files can be kept in the pharmacy's Google Drive; the row then records the Drive file instead of the bytes.
ALTER TABLE "FileObject" ALTER COLUMN "bytes" DROP NOT NULL,
ADD COLUMN "driveFileId" TEXT;
