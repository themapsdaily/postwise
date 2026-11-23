import { sessionCookie } from "../../../server/auth";

export async function POST(req: Request) {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(req, null) },
  });
}
