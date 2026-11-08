import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth/session";
import { StartDemo } from "@/components/start-demo";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (await currentActor()) redirect("/workbench");
  return <StartDemo />;
}
