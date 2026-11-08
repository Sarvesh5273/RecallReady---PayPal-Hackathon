import Link from "next/link";
import { Shell } from "@/components/shell";
import { EvidencePanel } from "@/components/evidence-panel";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Shell active="Workbench">
      <Link
        href="/workbench"
        className="quiet-link"
        style={{ justifyContent: "flex-start" }}
      >
        ← Back to workbench
      </Link>
      <div className="standalone">
        <EvidencePanel id={id} />
      </div>
    </Shell>
  );
}
