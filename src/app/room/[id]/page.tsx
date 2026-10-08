import RoomClient from "@/components/RoomClient";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="min-h-screen bg-slate-100">
      <RoomClient roomId={id} />
    </main>
  );
}
