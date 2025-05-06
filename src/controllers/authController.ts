import { Context } from "hono";
import {
  createTable,
  getUser,
  createUser,
  updateUser,
} from "../service/authService";

export default class AuthController {
  constructor() {
    createTable();
    createUser();
  }

  async login(ctx: Context) {
    const { username, password } = await ctx.req.json();
    const isValidUser = await getUser(username, password);
    if (isValidUser) {
      ctx.json({ message: "Login successful" });
    } else {
      ctx.json({ message: "Invalid username or password" }, 401);
    }
  }

  async update(ctx: Context) {
    const { username, password } = await ctx.req.json();
    const isUpdated = await updateUser(username, password);
    if (isUpdated) {
      ctx.json({ message: "User updated successfully" });
    } else {
      ctx.json({ message: "Failed to update user" }, 500);
    }
  }
}
