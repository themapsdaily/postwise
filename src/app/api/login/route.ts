import { z } from "zod";
import { authProblem, passwordMatches, sessionCookie, signSession } from "../../../server/auth";
import { fail, guard, readJson } from "../../../server/http";

export async function POST(req: Request) {
  return guard(async () => {
    const problem = authProblem();
    if (problem) return fail(503, problem);
    const body = await readJson(req, z.object({ password: z.string().max(1000) }));
    if (!body.ok) return body.res;
    if (!passwordMatches(body.data.password)) {
      await new Promise((r) => setTimeout(r, 400)); // slows guessing
      return fail(401, "Wrong password");
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": sessionCookie(req, signSession()) },
    });
  });
}
