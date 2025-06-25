import { Context } from "hono";
import { getUser, updateUser } from "../service/authService";
import { generateToken } from "../utils/token";

export class AuthController {
  async refresh(ctx: Context) {
    const { name } = await ctx.req.json();
    console.log("Refresh token data:", name);
    const token = generateToken({ name });
    return ctx.json({ message: "Token refreshed", token, authUserState: { name } });
  }

  async login(ctx: Context) {
    const { username, password } = await ctx.req.json();
    const isValidUser = await getUser(username, password);
    if (isValidUser) {
      const jwt = generateToken(username);
      return ctx.json({ message: "Login successful", token: jwt, authUserState: { name: username } });
    } else {
      return ctx.json({ message: "Invalid username or password" }, 401);
    }
  }

  async update(ctx: Context) {
    const { username, password } = await ctx.req.json();
    const isUpdated = await updateUser(username, password);
    if (isUpdated) {
      return ctx.json({ message: "User updated successfully" });
    } else {
      return ctx.json({ message: "Failed to update user" }, 500);
    }
  }

  async changePassword(ctx: Context) {
    const { oldPassword, newPassword } = await ctx.req.json();
    const session = ctx.get("session");
    const username = session.get("id");
    const isValidUser = await getUser(username, oldPassword);
    if (isValidUser) {
      const isUpdated = await updateUser(username, newPassword);
      if (isUpdated) {
        return ctx.json({ message: "Password updated successfully" });
      } else {
        return ctx.json({ message: "Failed to update password" }, 500);
      }
    } else {
      return ctx.json({ message: "Invalid old password" }, 401);
    }
  }
}
