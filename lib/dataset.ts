import { savedChoice } from "@/components/savedChoice";

// Which dataset the map shows. "illustrative" is the large generated one, "sample" is the real Sperry sample.
export type Dataset = "illustrative" | "sample";
export const DEFAULT_DATASET: Dataset = "illustrative";
export const datasetChoice = savedChoice("seams.dataset", (v) => v === "illustrative" || v === "sample");
