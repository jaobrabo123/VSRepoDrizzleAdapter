CREATE TYPE "OrderStatus" AS ENUM('PENDING', 'PAID', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "UserRole" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TABLE "Category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(100) NOT NULL UNIQUE,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OrderItem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"orderId" uuid NOT NULL,
	"productId" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unityPrice" numeric(12,2) NOT NULL,
	"subtotal" numeric(12,2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" uuid NOT NULL,
	"status" "OrderStatus" NOT NULL,
	"total" numeric(12,2) NOT NULL,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(150) NOT NULL,
	"description" varchar(3000) NOT NULL,
	"price" numeric(12,2) NOT NULL,
	"stock" integer NOT NULL,
	"active" boolean NOT NULL,
	"categoryId" uuid,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" uuid NOT NULL,
	"productId" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" varchar(500),
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(150) NOT NULL,
	"email" varchar(255) NOT NULL UNIQUE,
	"passwordHash" varchar(255) NOT NULL,
	"role" "UserRole" NOT NULL,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "OrderItem_orderId_productId_index" ON "OrderItem" ("orderId","productId");--> statement-breakpoint
CREATE UNIQUE INDEX "Review_userId_productId_index" ON "Review" ("userId","productId");--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_Order_id_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id");--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_Product_id_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id");--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id");--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_Category_id_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id");--> statement-breakpoint
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id");--> statement-breakpoint
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_Product_id_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id");