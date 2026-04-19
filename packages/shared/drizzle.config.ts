import { defineConfig } from "drizzle-kit";

// DATABASE_URL is only needed for `push`/`studio`/`migrate` commands — `generate`
// only reads the schema. Kept as a runtime env so the URL never lands in git.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://placeholder",
  },
  strict: true,
  verbose: true,
});
