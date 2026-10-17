import { createAIConnectionService } from "@/lib/server/ai-connection-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  const { path } = await context.params;
  return createAIConnectionService().handle(request, path.join("/"));
}
export const GET = handle;
export const POST = handle;
