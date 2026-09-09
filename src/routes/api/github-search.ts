import { createFileRoute } from "@tanstack/react-router";
import { searchCodeReposOnGithub } from "@/lib/github/search.server";

export const Route = createFileRoute("/api/github-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { query?: string; token?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid request." }, { status: 400 });
        }
        const query = body.query?.trim() ?? "";
        const token = body.token?.trim() ?? "";
        const result = await searchCodeReposOnGithub({ query, token });
        if (!result.ok) {
          const status =
            result.code === "unauthorized"
              ? 401
              : result.code === "rate_limit"
                ? 403
                : result.code === "invalid"
                  ? 422
                  : 502;
          return Response.json({ error: result.error }, { status });
        }
        return Response.json(result.data);
      },
    },
  },
});
