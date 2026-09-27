import { readFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import type { Project } from "@/lib/data";

export const runtime = "nodejs";

interface ProjectCollection {
  type: "FeatureCollection";
  features: Project[];
}

// Same order as scripts/build-overlaps.ts, so projects and overlaps come from the same data.
async function readLocalProjects(): Promise<ProjectCollection> {
  const primary = path.join(process.cwd(), "data/projects.geojson");
  try {
    return JSON.parse(await readFile(primary, "utf8")) as ProjectCollection;
  } catch {
    const fixtures = path.join(process.cwd(), "data/fixtures/projects.geojson");
    return JSON.parse(await readFile(fixtures, "utf8")) as ProjectCollection;
  }
}

export async function GET() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3_000 });
    try {
      await client.connect();
      const features = await client
        .db()
        .collection<Project>("projects")
        .find({}, { projection: { _id: 0 } })
        .toArray();
      if (features.length) return Response.json({ type: "FeatureCollection", features });
    } catch {
      // Use the local data when MongoDB cannot be reached.
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  try {
    return Response.json(await readLocalProjects());
  } catch {
    return Response.json({ error: "Project data is unavailable" }, { status: 500 });
  }
}
