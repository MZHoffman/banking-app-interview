import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync("../.env")) loadEnvFile("../.env");
if (existsSync(".env")) loadEnvFile(".env");

function databaseUrl(database: string): string {
  const host = process.env.POSTGRES_HOST ?? "localhost";
  const port = process.env.POSTGRES_PORT ?? "47833";
  const user = encodeURIComponent(process.env.POSTGRES_USER ?? "postgres");
  const password = process.env.POSTGRES_PASSWORD;
  const auth = password ? `${user}:${encodeURIComponent(password)}` : user;
  return `postgresql://${auth}@${host}:${port}/${encodeURIComponent(database)}`;
}

const databaseName = process.env.POSTGRES_DATABASE ?? "banking_app";

export const config = {
  port: Number(process.env.SERVER_PORT ?? "47832"),
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? "http://localhost:47831",
  databaseUrl: process.env.DATABASE_URL ?? databaseUrl(databaseName),
} as const;
