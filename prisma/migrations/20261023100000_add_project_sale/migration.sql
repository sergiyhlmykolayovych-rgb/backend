-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "file_key" VARCHAR(255),
ADD COLUMN     "file_name" VARCHAR(255),
ADD COLUMN     "file_size" INTEGER,
ADD COLUMN     "file_url" VARCHAR(500),
ADD COLUMN     "price" DECIMAL(10,2);
