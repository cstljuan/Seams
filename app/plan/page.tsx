import type { Metadata } from "next";
import PlanPage from "@/components/PlanPage";

export const metadata: Metadata = {
  title: "Coordination plan · Seams",
  description: "A printable coordination plan for the pairs picked in Seams.",
};

export default function Plan() {
  return <PlanPage />;
}
