-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "project_title" VARCHAR(150) NOT NULL,
    "chat_id" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "charge_id" VARCHAR(255) NOT NULL,
    "provider_charge_id" VARCHAR(255),
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "delivery_error" VARCHAR(255),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchases_charge_id_key" ON "purchases"("charge_id");

-- CreateIndex
CREATE INDEX "purchases_chat_id_paid_at_idx" ON "purchases"("chat_id", "paid_at");

-- CreateIndex
CREATE INDEX "purchases_paid_at_idx" ON "purchases"("paid_at");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
