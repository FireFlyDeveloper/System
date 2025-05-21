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
router.get(
  "/devices/update-position/:id",
  authMiddleware,
  deviceController.updatePosition,
);
router.post(
  "/devices/add-devices",
  authMiddleware,
  deviceController.addDevices,
);
router.post(
  "/devices/update-devices",
  authMiddleware,
  deviceController.updateDevices,
);
router.post(
  "/devices/delete-devices",
  authMiddleware,
  deviceController.deleteDevices,
);

export default router;
