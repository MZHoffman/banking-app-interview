import { connectedDatabaseUrl } from "./config.ts";
import { seedDatabase } from "./database.ts";

await seedDatabase(connectedDatabaseUrl);
