import { createFileRoute } from "@tanstack/react-router";

type ChatMessage = { role: string; content: string };

export const Route = createFileRoute("/api/review")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "Hosted review is unavailable in this environment." },
            { status: 503 },
          );
        }

        let body: {
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
        if (total > 180_000) {
          return Response.json(
            { error: "The selected files are too large. Lower the file budget." },
            { status: 413 },
          );
        }

        const temperature = Math.min(Math.max(Number(body.temperature) || 0.2, 0), 1.2);

        const upstream = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "grok-4.5",
            messages: messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
            temperature,
            max_tokens: 4096,
            stream: true,
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text();
          return Response.json(
            {
              error:
                text.replace(/\s+/g, " ").slice(0, 220) ||
                `Hosted model error ${upstream.status}`,
            },
            { status: upstream.status || 502 },
          );
        }

        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
