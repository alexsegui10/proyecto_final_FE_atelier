import { DemoSelector } from "@/components/builder/discover/demo-selector";
import { DiscoverChat } from "@/components/builder/discover/discover-chat";

export default function DiscoverPage() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <DemoSelector />
      <div className="flex-1 overflow-hidden">
        <DiscoverChat />
      </div>
    </div>
  );
}
