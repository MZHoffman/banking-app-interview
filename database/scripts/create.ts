import { adminDatabaseUrl, databaseName } from "./config.ts";
import { createDatabase } from "./database.ts";

await createDatabase(adminDatabaseUrl, databaseName);
