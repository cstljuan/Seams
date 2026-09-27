import { readFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { DB_NAME, SOURCE_HEADER } from "@/lib/mongo";
import type { Overlap } from "@/lib/data";

export const runtime = "nodejs";

async function readLocalOverlaps(): Promise<Overlap[]> {
  const primary = path.join(process.cwd(), "data/overlaps.json");
  try {
    return JSON.parse(await readFile(primary, "utf8")) as Overlap[];
  } catch {
    const fixtures = path.join(process.cwd(), "data/fixtures/overlaps.json");
    return JSON.parse(await readFile(fixtures, "utf8")) as Overlap[];
  }
}

export async function GET() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3_000 });
    try {
      await client.connect();
      const overlaps = await client
        .db(DB_NAME)
        .collection<Overlap>("overlaps")
        .find({}, { projection: { _id: 0 } })
        .sort({ rank: 1 })
        .toArray();
      if (overlaps.length) {
        return Response.json(overlaps, { headers: { [SOURCE_HEADER]: "atlas" } });
      }
    } catch {
      // Use the local data when MongoDB cannot be reached.
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  try {
    return Response.json(await readLocalOverlaps(), { headers: { [SOURCE_HEADER]: "local" } });
  } catch {
    return Response.json({ error: "Overlap data is unavailable" }, { status: 500 });
  }
}
