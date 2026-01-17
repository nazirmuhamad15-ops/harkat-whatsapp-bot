import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from root or specific bot folder. 
// Assuming bot is just a folder in the main repo, let's look for root .env too?
// Or user configured .env in bot folder.
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); 

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing in environment variables');
}

// Disable prefetch as it is not supported for "Transaction" pool mode if Supabase
const client = postgres(process.env.DATABASE_URL, { prepare: false });
export const db = drizzle(client, { schema });
