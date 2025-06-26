import { Context } from "hono";
import {
  addDevice,
  updateDevice,
  deleteDevice,
  getDeviceById,
  getAllDevices,
  updateDevicePosition,
  addDevices,
  updateDevices,
  deleteDevices,
} from "../service/deviceService";
import { positionController } from "../app";

export class DeviceController {
  async create(ctx: Context) {
    const { mac, name, saved_position } = await ctx.req.json();
    const success = await addDevice(mac, name, saved_position);
    if (success) {
      await positionController.init();
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
      await positionController.init();
      return ctx.json({ message: "Device updated successfully" });
    } else {
      return ctx.json({ message: "Failed to update device" }, 500);
    }
  }

  async delete(ctx: Context) {
    const id = Number(ctx.req.param("id"));
    const success = await deleteDevice(id);
    if (success) {
      await positionController.init();
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
    const formattedDevices = devices.map((device) => {
      return {
        id: device.id,
        name: device.name,
        mac: device.mac,
        lastUpdated: device.updated_at,
        status: device.status,
        monitoring: device.enable,
      }
    });
    return ctx.json(formattedDevices);
  }

  async updatePosition(ctx: Context) {
    const id = Number(ctx.req.param("id"));
    const { saved_position } = await ctx.req.json();
    const success = await updateDevicePosition(id, saved_position);
    if (success) {
      await positionController.init();
      return ctx.json({ message: "Device position updated successfully" });
    } else {
      return ctx.json({ message: "Failed to update device position" }, 500);
    }
  }

  async addDevices(ctx: Context) {
    const devices = await ctx.req.json();
    const success = await addDevices(devices.devices);
    if (success) {
      const formattedDevices = success.map((device: any) => {
        return {
          id: device.id,
          name: device.name,
          mac: device.mac,
          lastUpdated: device.updated_at,
          status: device.status,
          monitoring: device.enable,
        }
      });
      await positionController.init();
      return ctx.json({ message: "Devices added successfully", devices: formattedDevices });
    } else {
      return ctx.json({ message: "Failed to add devices" }, 500);
    }
  }

  async updateDevices(ctx: Context) {
    const devices = await ctx.req.json();
    console.log(devices);
    const success = await updateDevices(devices.devices);
    if (success) {
      await positionController.init();
      return ctx.json({ message: "Devices updated successfully" });
    } else {
      return ctx.json({ message: "Failed to update devices" }, 500);
    }
  }

  async deleteDevices(ctx: Context) {
    const devices = await ctx.req.json();
    const success = await deleteDevices(devices.ids);
    if (success) {
      await positionController.init();
      return ctx.json({ message: "Devices deleted successfully" });
    } else {
      return ctx.json({ message: "Failed to delete devices" }, 500);
    }
  }
}
