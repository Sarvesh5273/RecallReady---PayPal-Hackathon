import { Shell } from "@/components/shell";
import { ActivityFeed } from "@/components/activity-feed";
export default function Page() {
  return (
    <Shell active="Activity">
      <ActivityFeed />
    </Shell>
  );
}
