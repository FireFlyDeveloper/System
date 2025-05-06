import { Context, Next } from "hono";
import { verifyToken } from "../utils/token";

export const sessionMiddleware = async (c: Context, next: Next) => {
  const session = c.get("session");
  const jwt = session.get("jwt");

  try {
    const decoded = verifyToken(jwt);
    c.set("user", decoded);
    await next();
  } catch (err) {
    session.forget("id");
    session.forget("jwt");
    return c.redirect("/", 302);
  }
};
