import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit runs locally only; .env.local is loaded via the db:* scripts.
    url: process.env.DATABASE_URL!,
  },
});
