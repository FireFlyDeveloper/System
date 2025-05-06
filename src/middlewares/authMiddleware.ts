import { Context, Next } from "hono";
import { verifyToken } from "../utils/token";

export const authMiddleware = async (c: Context, next: Next) => {
  const session = c.get("session");
  const jwt = session.get("jwt");

  if (!jwt) {
    session.forget("id");
    session.forget("jwt");
    return c.json({ message: "Unauthorized" }, 401);
  }

  try {
    const decoded = verifyToken(jwt);
    c.set("user", decoded);
    await next();
  } catch (err) {
    session.forget("id");
    session.forget("jwt");
    return c.json({ message: "Unauthorized" }, 401);
  }
};
