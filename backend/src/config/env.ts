import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bascula_erp",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret"
};
