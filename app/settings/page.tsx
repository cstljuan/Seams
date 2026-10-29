import type { Metadata } from "next";
import SettingsPage from "@/components/SettingsPage";

export const metadata: Metadata = {
  title: "Settings · Seams",
  description: "Customize Arc, the theme, motion, units and the default dataset.",
};

export default function Settings() {
  return <SettingsPage />;
}
