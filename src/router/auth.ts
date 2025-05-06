import { Hono } from "hono";
import AuthController from "../controllers/authController";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = new Hono();

router.post("/user", authMiddleware, AuthController.login);
router.post("/update", authMiddleware, AuthController.update);

export default router;
