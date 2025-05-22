import { Context } from "hono";
import { PositioningSystem } from "../system/calculator";
import {
  createDevicesTable,
  getAllDevices,
  updatePositionByMac,
} from "../service/deviceService";
import { WSContext } from "hono/ws";
import { createTable, createUser } from "../service/authService";
import { createAlertsTable } from "../service/alertsService";

export default class PositionController {
  private positioningSystem!: PositioningSystem;

  // Static factory method for safe async initialization
  async create() {
    await this.createTables();
    this.positioningSystem = new PositioningSystem();
    await this.init();
  }

  private async createTables() {
    await createTable();
    await createUser();
    await createDevicesTable();
    await createAlertsTable();
    console.log("Tables created successfully");
  }

  async init() {
    const initialMacs = await getAllDevices();
    if (!initialMacs || initialMacs.length === 0) {
      console.error("No devices found in the database");
      return;
    }
    this.positioningSystem.setDeviceIdMap(initialMacs);
    const macs = initialMacs.map((device) => device.mac.toLowerCase());
    this.positioningSystem.setTargetMacs(macs);

    const savedPositions = initialMacs.reduce(
      (acc, device) => {
        const mac = device.mac.toLowerCase();
        const pos = device.saved_position;
        if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
          acc[mac] = { x: pos.x, y: pos.y };
        }
        return acc;
      },
      {} as { [mac: string]: { x: number; y: number } },
    );

    this.positioningSystem.setSavedPositions(savedPositions);
  }

  async setTargetMacs(ctx: Context) {
    try {
      const { macs } = await ctx.req.json();
      if (!Array.isArray(macs)) {
        throw new Error("Invalid MAC list");
      }
      this.positioningSystem.setTargetMacs(macs);
      return ctx.json({ message: "Target MACs set successfully" });
    } catch (err: any) {
      return ctx.json({ message: err.message }, 400);
    }
  }

  async updateTargetMacs(ctx: Context) {
    try {
      const { macs } = await ctx.req.json();
      if (!Array.isArray(macs)) {
        throw new Error("Invalid MAC list");
      }
      this.positioningSystem.updateTargetMacs(macs);
      return ctx.json({ message: "Target MACs updated successfully" });
    } catch (err: any) {
      return ctx.json({ message: err.message }, 400);
    }
  }

  async setPosition(ctx: Context) {
    try {
      const { position } = await ctx.req.json();
      this.positioningSystem.setSavedPositions(position);
      return ctx.json({ message: "Position set successfully" });
    } catch (err: any) {
      return ctx.json({ message: err.message }, 400);
    }
  }

  async getAllPositions(ctx: Context) {
    const positions = this.positioningSystem.getAllPositions();
    return ctx.json(positions);
  }

  async getPosition(ctx: Context) {
    const mac = ctx.req.param("mac");
    const position = this.positioningSystem.getPosition(mac);
    if (position) {
      const success = await updatePositionByMac(mac, position);
      if (success) {
        await this.init();
        return ctx.json({ message: "Position updated successfully" });
      }
      return ctx.json("Position updated but failed to save to database");
    } else {
      ctx.status(404);
      return ctx.json({ message: "Position not found" });
    }
  }

  async setWebSocketContext(ctx: WSContext) {
    if (!this.positioningSystem) {
      ctx.send(JSON.stringify({ error: "Positioning system not initialized" }));
      return;
    }

    this.positioningSystem.setWebSocketContext(ctx);
    return ctx.send(
      JSON.stringify({ message: "WebSocket context set successfully" }),
    );
  }
}
