import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const encode = encodeURIComponent;
const host = process.env.POSTGRES_HOST ?? "localhost";
const port = process.env.POSTGRES_PORT ?? "47833";
const user = encode(process.env.POSTGRES_USER ?? "postgres");
const password = process.env.POSTGRES_PASSWORD;
const auth = password ? `${user}:${encode(password)}` : user;
const database = encode(process.env.POSTGRES_DATABASE ?? "banking_app");

// The scripts and the server share one database, so both read DATABASE_URL first.
export const connectedDatabaseUrl = process.env.DATABASE_URL ?? `postgresql://${auth}@${host}:${port}/${database}`;

const url = new URL(connectedDatabaseUrl);
export const databaseName = decodeURIComponent(url.pathname.slice(1));
url.pathname = encode(process.env.POSTGRES_ADMIN_DATABASE ?? "postgres");
export const adminDatabaseUrl = url.toString();
