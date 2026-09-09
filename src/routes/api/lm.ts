import { createFileRoute } from "@tanstack/react-router";
import { fetchLmStudioChat, fetchLmStudioModels } from "@/lib/llm/lmstudio.server";

type ChatMessage = { role: string; content: string };

export const Route = createFileRoute("/api/lm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const status = await fetchLmStudioModels(
          url.searchParams.get("baseUrl") ?? undefined,
        );
        return Response.json(status);
      },
      POST: async ({ request }) => {
        let body: {
          baseUrl?: string;
          model?: string;
          messages?: ChatMessage[];
          temperature?: number;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid request." }, { status: 400 });
        }

        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (messages.length === 0) {
          return Response.json({ error: "Nothing to review." }, { status: 400 });
        }

        const total = messages.reduce(
          (sum, msg) => sum + (msg.content?.length ?? 0),
          0,
        );
        if (total > 2_000_000) {
          return Response.json(
            { error: "The selected files are too large even for local review. Uncheck some files." },
            { status: 413 },
          );
        }

        const model = body.model?.trim();
        if (!model) {
          return Response.json(
            { error: "Pick a loaded LM Studio model in Settings." },
            { status: 400 },
          );
        }

        const temperature = Math.min(Math.max(Number(body.temperature) || 0.2, 0), 1.2);

        return fetchLmStudioChat({
          requestedUrl: body.baseUrl,
          model,
          messages,
          temperature,
        });
      },
    },
  },
});
