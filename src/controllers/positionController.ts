import { Context } from "hono";
import { PositioningSystem } from "../system/calculator";
import { createDevicesTable, getAllDevices } from "../service/deviceService";
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
