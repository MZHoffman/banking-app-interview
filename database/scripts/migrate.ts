import { connectedDatabaseUrl } from "./config.ts";
import { migrateDatabase } from "./database.ts";

await migrateDatabase(connectedDatabaseUrl);
