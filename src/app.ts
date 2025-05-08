import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { CookieStore, Session, sessionMiddleware } from "hono-sessions";
import { SessionDataTypes } from "./model/types";
import { serveHTML } from "./utils/serverHTML";
import { sessionsMiddleware } from "./middlewares/sessionMiddleware";
import authUser from "./router/auth";

const app = new Hono<{
  Variables: {
    session: Session<SessionDataTypes>;
  };
}>();

const store = new CookieStore();

app.use(
  "*",
  sessionMiddleware({
    store,
    encryptionKey: process.env.ENCRYPTION_KEY,
    expireAfterSeconds: 2592000,
    cookieOptions: {
      sameSite: "Lax",
      path: "/",
      httpOnly: true,
    },
  }),
);

app.use("/static/*", serveStatic({ root: "./src/" }));

app.get("/", sessionsMiddleware, (c) => c.html(serveHTML("login.html")));
app.get("/dashboard", sessionsMiddleware, (c) =>
  c.html(serveHTML("home.html")),
);
app.get("/dashboard/alerts", sessionsMiddleware, (c) =>
  c.html(serveHTML("alerts.html")),
);
app.get("/dashboard/settings", sessionsMiddleware, (c) =>
  c.html(serveHTML("settings.html")),
);
app.get("/dashboard/admin", sessionsMiddleware, (c) =>
  c.html(serveHTML("admin.html")),
);

app.route("/auth", authUser);

app.post("/logout", sessionsMiddleware, (c) => {
  const session = c.get("session");
  session.forget("id");
  session.forget("jwt");
  return c.redirect("/");
});

export default app;
