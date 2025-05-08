import { Context, Next } from "hono";
import { verifyToken } from "../utils/token";

export const sessionsMiddleware = async (c: Context, next: Next) => {
  const session = c.get("session");
  const jwt = session.get("jwt");

  if (!jwt) {
    if (c.req.path === "/") {
      return await next();
    }
    session.forget("id");
    session.forget("jwt");
    return c.redirect("/");
  }

  try {
    const decoded = verifyToken(jwt);
    c.set("user", decoded);

    if (c.req.path === "/") {
      return c.redirect("/dashboard");
    }

    await next();
  } catch (err) {
    session.forget("id");
    session.forget("jwt");
    return c.redirect("/");
  }
};
