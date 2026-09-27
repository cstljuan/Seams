// Shared MongoDB settings for the API routes and the seed script.
export const DB_NAME = process.env.MONGODB_DB || "seams";
export const SOURCE_HEADER = "x-seams-source";
