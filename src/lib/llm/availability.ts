import { createServerFn } from "@tanstack/react-start";

export const getGrokAvailability = createServerFn({ method: "GET" }).handler(
  async () => {
    return { grok: Boolean(process.env.XAI_API_KEY) };
  },
);
