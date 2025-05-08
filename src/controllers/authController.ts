import { Context } from "hono";
import {
  createTable,
  getUser,
  createUser,
  updateUser,
} from "../service/authService";
import { generateToken } from "../utils/token";

export class AuthController {
  constructor() {
    this.initialize();
  }

  private async initialize() {
    await createTable();
    await createUser();
  }

  async login(ctx: Context) {
    const { username, password } = await ctx.req.json();
    const isValidUser = await getUser(username, password);
    if (isValidUser) {
      const session = ctx.get("session");
      session.set("id", username);
      const jwt = generateToken(username);
      session.set("jwt", jwt);
      return ctx.json({ message: "Login successful" });
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
}
