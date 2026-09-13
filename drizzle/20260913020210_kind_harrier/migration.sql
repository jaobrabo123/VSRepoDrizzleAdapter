CREATE TABLE "Address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"city" varchar(150) NOT NULL,
	"state" char(2) NOT NULL,
	"userId" uuid NOT NULL UNIQUE,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" varchar(100) NOT NULL,
	"content" varchar(1000) NOT NULL,
	"categoryId" uuid,
	"userId" uuid NOT NULL,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_Order_id_fkey";--> statement-breakpoint
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_Product_id_fkey";--> statement-breakpoint
ALTER TABLE "Review" DROP CONSTRAINT "Review_productId_Product_id_fkey";--> statement-breakpoint
DROP TABLE "OrderItem";--> statement-breakpoint
DROP TABLE "Order";--> statement-breakpoint
DROP TABLE "Product";--> statement-breakpoint
DROP TABLE "Review";--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER'::"UserRole";--> statement-breakpoint
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "Post" ADD CONSTRAINT "Post_categoryId_Category_id_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "Post" ADD CONSTRAINT "Post_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP TYPE "OrderStatus";