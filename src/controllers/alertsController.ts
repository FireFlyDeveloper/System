import { Context } from "hono";
import {
  addAlert,
  getAlertsByDeviceId,
  getAllAlerts,
  deleteAlert,
} from "../service/alertsService";

export class AlertController {
  async create(ctx: Context) {
    const { device_id, message, type } = await ctx.req.json();
    const success = await addAlert(device_id, message, type);
    if (success) {
      return ctx.json({ message: "Alert created successfully" });
    } else {
      return ctx.json({ message: "Failed to create alert" }, 500);
    }
  }

  async getByDeviceId(ctx: Context) {
    const device_id = Number(ctx.req.param("device_id"));
    const alerts = await getAlertsByDeviceId(device_id);
    return ctx.json(alerts);
  }

  async getAll(ctx: Context) {
    const page = Number(ctx.req.param("page")) || 1;
    const alerts = await getAllAlerts(page);
    return ctx.json(alerts);
  }

  async getAllFilter(ctx: Context) {
    const page = Number(ctx.req.param("page")) || 1;
    const filter = ctx.req.param("filter");
    const alerts = await getAllAlerts(page, filter);
    return ctx.json(alerts);
  }

  async delete(ctx: Context) {
    const id = Number(ctx.req.param("id"));
    const success = await deleteAlert(id);
    if (success) {
      return ctx.json({ message: "Alert deleted successfully" });
    } else {
      return ctx.json({ message: "Failed to delete alert" }, 500);
    }
  }
}
