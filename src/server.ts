import { serve } from "@hono/node-server";
import app from "./app";

const PORT = parseInt(process.env.PORT || "3000", 10);

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`🚀 Server running at http://localhost:${PORT}`);
