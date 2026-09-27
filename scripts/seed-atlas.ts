// Loads projects and overlaps into MongoDB Atlas.
// Run `npm run build:overlaps` first so the overlaps include cost estimates.
// Safe to run again: each run replaces both collections with the local data.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { DB_NAME } from "../lib/mongo";
import type { Overlap, Project } from "../lib/data";

async function readFirst<T>(files: string[]): Promise<{ file: string; data: T }> {
  for (const file of files) {
    try {
      return { file, data: JSON.parse(await readFile(file, "utf8")) as T };
    } catch {
      // Try the next file.
    }
  }
  throw new Error(`None of these files could be read: ${files.join(", ")}`);
}

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file. MONGODB_URI can still come from the shell.
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI in .env or in the shell first.");

  const root = process.cwd();
  const projects = await readFirst<{ features: Project[] }>([
    path.join(root, "data/projects.geojson"),
    path.join(root, "data/fixtures/projects.geojson"),
  ]);
  const overlaps = await readFirst<Overlap[]>([
    path.join(root, "data/overlaps.json"),
    path.join(root, "data/fixtures/overlaps.json"),
  ]);
  console.log(`Projects from ${path.relative(root, projects.file)}`);
  console.log(`Overlaps from ${path.relative(root, overlaps.file)}`);

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const seed = [
      ["projects", projects.data.features],
      ["overlaps", overlaps.data],
    ] as const;
    for (const [name, docs] of seed) {
      const collection = db.collection(name);
      await collection.deleteMany({});
      // Copy each doc so the driver's added _id does not leak into later runs.
      await collection.insertMany(docs.map((doc) => ({ ...doc })));
      console.log(`${name}: ${await collection.countDocuments()} documents in ${DB_NAME}`);
    }
    await db.collection("projects").createIndex({ "properties.id": 1 }, { unique: true });
    await db.collection("overlaps").createIndex({ rank: 1 });
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
