import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { serveHTML } from "./utils.ts/serverHTML";

const app = new Hono();

app.use("/static/*", serveStatic({ root: "./src/" }));

app.get("/", (c) => c.html(serveHTML("login.html")));
app.get("/dashboard", (c) => c.html(serveHTML("home.html")));
app.get("/dashboard/alerts", (c) => c.html(serveHTML("alerts.html")));
app.get("/dashboard/settings", (c) => c.html(serveHTML("settings.html")));
app.get("/dashboard/admin", (c) => c.html(serveHTML("admin.html")));

export default app;
