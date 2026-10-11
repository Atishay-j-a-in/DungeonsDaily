import { MongoClient, Db } from "mongodb";
import { env, hasMongo } from "../config/env.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db | null> {
  if (!hasMongo) {
    console.log("[db] MONGODB_URI not set — using in-memory store (dev fallback).");
    return null;
  }
  if (db) return db;
  // Bounded timeouts: Atlas unreachable (IP allowlist, network change, idle
  // drop) must fail fast into the in-memory fallback / 502 — not hang every
  // request for the driver's 30s default server-selection timeout.
  client = new MongoClient(env.mongodbUri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  await client.connect();
  db = client.db(env.mongodbDbName);
  await ensureIndexes(db);
  console.log(`[db] Connected to MongoDB (${env.mongodbDbName})`);
  return db;
}

export function getDb(): Db | null {
  return db;
}

async function ensureIndexes(database: Db): Promise<void> {
  await database.collection("sessions").createIndex({ userId: 1 });
  await database.collection("sessions").createIndex({ status: 1 });
  await database.collection("session_turns").createIndex({ sessionId: 1 });
  await database
    .collection("session_turns")
    .createIndex({ sessionId: 1, turnNumber: 1 }, { unique: true });
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
