import { Hono } from "hono";
import { DeviceController } from "../controllers/deviceController";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = new Hono();

const deviceController = new DeviceController();

router.post("/devices", authMiddleware, deviceController.create);
router.put("/devices/:id", authMiddleware, deviceController.update);
router.delete("/devices/:id", authMiddleware, deviceController.delete);
router.get("/devices/:id", authMiddleware, deviceController.getById);
router.get("/devices", authMiddleware, deviceController.getAll);

export default router;
