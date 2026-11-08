import { currentActor } from "@/lib/auth/session";
import { StartDemo } from "@/components/start-demo";
export const dynamic = "force-dynamic";
export default async function ProductPage() {
  return <StartDemo signedIn={!!(await currentActor())} />;
}
