import { StudioCanvas } from "./studio-canvas";

export default async function StudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  return <StudioCanvas />;
}
