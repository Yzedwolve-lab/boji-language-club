import { parseProfile } from "../../../lib/server/profile";
import { errorResponse, jsonBody } from "../../../lib/server/errors";
import { handleApi } from "../../../lib/server/api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.APP_MODE === "production")
    return handleApi(request, ["onboarding"]);
  try {
    const parsed = parseProfile(await jsonBody(request));
    if ("errors" in parsed) return Response.json(parsed, { status: 400 });
    return Response.json({
      ...parsed,
      mode: "demo",
      notice:
        "Local demo profile validation. No account or official certification has been created.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
