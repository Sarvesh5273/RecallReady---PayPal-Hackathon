import { Shell } from "@/components/shell";
import { SourceReview } from "@/components/source-review";
export default function Page() {
  return (
    <Shell active="Source & rules">
      <SourceReview />
    </Shell>
  );
}
