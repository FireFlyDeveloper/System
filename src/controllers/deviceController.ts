import { Context } from "hono";
import {
  addDevice,
  updateDevice,
  deleteDevice,
  getDeviceById,
  getAllDevices,
  updateDevicePosition,
} from "../service/deviceService";
import { positionController } from "../app";

export class DeviceController {
  async create(ctx: Context) {
    const { mac, name, saved_position } = await ctx.req.json();
    const success = await addDevice(mac, name, saved_position);
    if (success) {
      positionController.init();
      return ctx.json({ message: "Device created successfully" });
    } else {
      return ctx.json({ message: "Failed to create device" }, 500);
    }
  }

  async update(ctx: Context) {
    const id = Number(ctx.req.param("id"));
    const { mac, name, saved_position, status } = await ctx.req.json();
    const success = await updateDevice(id, mac, name, saved_position, status);
    if (success) {
      positionController.init();
      return ctx.json({ message: "Device updated successfully" });
    } else {
      return ctx.json({ message: "Failed to update device" }, 500);
    }
  }

  async delete(ctx: Context) {
    const id = Number(ctx.req.param("id"));
    const success = await deleteDevice(id);
    if (success) {
      positionController.init();
      return ctx.json({ message: "Device deleted successfully" });
    } else {
      return ctx.json({ message: "Failed to delete device" }, 500);
    }
  }

  async getById(ctx: Context) {
    const id = Number(ctx.req.param("id"));
    const device = await getDeviceById(id);
    if (device) {
      return ctx.json(device);
    } else {
      return ctx.json({ message: "Device not found" }, 404);
    }
  }

  async getAll(ctx: Context) {
    const devices = await getAllDevices();
    return ctx.json(devices);
  }

  async updatePosition(ctx: Context) {
    const id = Number(ctx.req.param("id"));
    const { saved_position } = await ctx.req.json();
    const success = await updateDevicePosition(id, saved_position);
    if (success) {
      positionController.init();
      return ctx.json({ message: "Device position updated successfully" });
    } else {
      return ctx.json({ message: "Failed to update device position" }, 500);
    }
  }
}
