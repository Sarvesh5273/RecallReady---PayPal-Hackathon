import { Shell } from "@/components/shell";
import { Workbench } from "@/components/workbench";
export default function Page() {
  return (
    <Shell active="Workbench">
      <Workbench />
    </Shell>
  );
}
