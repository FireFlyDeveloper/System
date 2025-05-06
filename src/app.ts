import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { serveHTML } from "./utils/serverHTML";
import { sessionMiddleware } from "./middlewares/sessionMiddleware";

const app = new Hono();

app.use("/static/*", serveStatic({ root: "./src/" }));

app.get("/", sessionMiddleware, (c) => c.html(serveHTML("login.html")));
app.get("/dashboard", sessionMiddleware, (c) => c.html(serveHTML("home.html")));
app.get("/dashboard/alerts", sessionMiddleware, (c) =>
  c.html(serveHTML("alerts.html")),
);
app.get("/dashboard/settings", sessionMiddleware, (c) =>
  c.html(serveHTML("settings.html")),
);
app.get("/dashboard/admin", sessionMiddleware, (c) =>
  c.html(serveHTML("admin.html")),
);

export default app;
