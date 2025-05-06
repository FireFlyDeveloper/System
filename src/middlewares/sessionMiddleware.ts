import { Context, Next } from "hono";
import { verifyToken } from "../utils/token";

export const sessionsMiddleware = async (c: Context, next: Next) => {
  if (c.req.path === "/") {
    return await next();
  }

  const session = c.get("session");
  const jwt = session.get("jwt");

  if (!jwt) {
    session.forget("id");
    session.forget("jwt");
    return c.redirect("/");
  }

  try {
    const decoded = verifyToken(jwt);
    c.set("user", decoded);
    await next();

    if (c.req.path === "/") {
      c.redirect("/dashboard");
    }
  } catch (err) {
    session.forget("id");
    session.forget("jwt");
    return c.redirect("/");
  }
};
