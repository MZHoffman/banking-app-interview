import { connectedDatabaseUrl } from "./config.ts";
import { migrateDatabase, resetDatabase, seedDatabase } from "./database.ts";

await resetDatabase(connectedDatabaseUrl);
await migrateDatabase(connectedDatabaseUrl);
await seedDatabase(connectedDatabaseUrl);
