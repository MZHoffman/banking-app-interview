import { adminDatabaseUrl, connectedDatabaseUrl, databaseName } from "./config.ts";
import { createDatabase, migrateDatabase, seedDatabase } from "./database.ts";

await createDatabase(adminDatabaseUrl, databaseName);
await migrateDatabase(connectedDatabaseUrl);
await seedDatabase(connectedDatabaseUrl);
