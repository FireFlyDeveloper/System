import { Hono } from "hono";
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
const app = new Hono();

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

app.route("/auth", authUser);
app.route("/api", device);
app.route("/api", alerts);

app.post("/api/position/train", authMiddleware, (c) => {
  return positionController.train(c);
});
app.post("/api/position/refresh", authMiddleware, (c) => {
  return positionController.refresh(c);
});

export default {
  fetch: app.fetch,
  websocket,
};
