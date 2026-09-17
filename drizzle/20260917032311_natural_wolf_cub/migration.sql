CREATE TABLE "PostTag" (
	"postId" uuid,
	"tagId" uuid,
	CONSTRAINT "PostTag_pkey" PRIMARY KEY("postId","tagId")
);
--> statement-breakpoint
CREATE TABLE "Tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(100) NOT NULL UNIQUE,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_postId_Post_id_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_tagId_Tag_id_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE;