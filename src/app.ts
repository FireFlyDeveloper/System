import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { CookieStore, Session, sessionMiddleware } from "hono-sessions";
import { SessionDataTypes } from "./model/types";
import { serveHTML } from "./utils/serverHTML";
import { sessionsMiddleware } from "./middlewares/sessionMiddleware";
import authUser from "./router/auth";
import device from "./router/device";
import alerts from "./router/alerts";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { UptimeClock } from "./utils/clock";
import PositionController from "./controllers/positionController";
import { authMiddleware } from "./middlewares/authMiddleware";
import { cors } from 'hono/cors'

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const clock = new UptimeClock();
const app = new Hono<{
  Variables: {
    session: Session<SessionDataTypes>;
  };
}>();

const store = new CookieStore();
export const positionController = new PositionController();
positionController.create();

app.use('*', cors());
app.use(
  '*',
  cors({
    origin: ['http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type'],
  })
);

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

app.get(
  "/uptime",
  upgradeWebSocket((c) => {
    let interval: NodeJS.Timer;

    return {
      onOpen(_event, ws) {
        interval = setInterval(() => {
          ws.send(clock.getUptime());
        }, 1000);
      },
      onClose: () => {
        clearInterval(interval);
        console.log("Connection closed");
      },
    };
  }),
);

app.get(
  "/status",
  authMiddleware,
  upgradeWebSocket((c) => {
    return {
      onOpen(_event, ws) {
        positionController.setWebSocketContext(ws);
      },
      onClose: () => {
        console.log("Connection closed");
      },
    };
  }),
);

app.get("/", sessionsMiddleware, (c) => c.html(serveHTML("login.html")));
app.get("/dashboard", sessionsMiddleware, (c) =>
  c.html(serveHTML("home.html")),
);
app.get("/dashboard/logs", sessionsMiddleware, (c) =>
  c.html(serveHTML("logs.html")),
);
app.get("/dashboard/admin", sessionsMiddleware, (c) =>
  c.html(serveHTML("admin.html")),
);

app.route("/auth", authUser);
app.route("/api", device);
app.route("/api", alerts);

app.post("/api/position/train", sessionsMiddleware, (c) => {
  return positionController.train(c);
});
app.post("/api/position/refresh", sessionsMiddleware, (c) => {
  return positionController.refresh(c);
});

app.post("/logout", sessionsMiddleware, (c) => {
  const session = c.get("session");
  session.forget("id");
  session.forget("jwt");
  return c.redirect("/");
});

export default {
  fetch: app.fetch,
  websocket,
};
