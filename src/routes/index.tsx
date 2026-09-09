import { createFileRoute } from "@tanstack/react-router";
import { QuarryApp } from "@/components/quarry/app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <QuarryApp />;
}
