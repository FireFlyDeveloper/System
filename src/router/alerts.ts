import { Hono } from "hono";
import { AlertController } from "../controllers/alertsController";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = new Hono();

const alertController = new AlertController();

router.post("/alerts", authMiddleware, alertController.create);
router.get(
  "/alerts/device/:device_id",
  authMiddleware,
  alertController.getByDeviceId,
);
router.get("/alerts/:page", authMiddleware, alertController.getAll);
router.get(
  "/alerts/:page/:filter",
  authMiddleware,
  alertController.getAllFilter,
);
router.delete("/alerts/:id", authMiddleware, alertController.delete);

export default router;
