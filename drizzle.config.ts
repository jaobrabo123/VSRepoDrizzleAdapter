import "dotenv/config";
import { defineConfig } from "drizzle-kit";
export default defineConfig({
    out: "./drizzle",
    schema: "./dev/drizzle/schema.ts",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
    migrations: {
        schema: "public",
    },
});
