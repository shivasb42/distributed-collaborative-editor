import { listSharedDocuments } from "@/lib/shared-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const documents = await listSharedDocuments();
  return Response.json({ documents });
}
