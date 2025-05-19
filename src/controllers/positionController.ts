import { Context } from "hono";
import { PositioningSystem } from "../system/calculator";
import { getAllDevices } from "../service/deviceService";
import { WSContext } from "hono/ws";

export default class PositionController {
  private positioningSystem: PositioningSystem;

  constructor() {
    this.positioningSystem = new PositioningSystem();
    this.initialize().then((initialMacs) => {
      this.positioningSystem.setTargetMacs(initialMacs);
    });
  }

  private async initialize() {
    const savedPositions = await getAllDevices();
    const initialMacs = savedPositions.map((device) =>
      device.mac.toLowerCase(),
    );
    return initialMacs;
  }

  async setTargetMacs(ctx: Context) {
    const { macs } = await ctx.req.json();
    this.positioningSystem.setTargetMacs(macs);
    return ctx.json({ message: "Target MACs set successfully" });
  }

  async updateTargetMacs(ctx: Context) {
    const { macs } = await ctx.req.json();
    this.positioningSystem.updateTargetMacs(macs);
    return ctx.json({ message: "Target MACs updated successfully" });
  }

  async setPosition(ctx: Context) {
    const { position } = await ctx.req.json();
    this.positioningSystem.setSavedPositions(position);
    return ctx.json({ message: "Position set successfully" });
  }

  async getAllPositions(ctx: Context) {
    const positions = this.positioningSystem.getAllPositions();
    return ctx.json(positions);
  }

  async getPosition(ctx: Context) {
    const mac = ctx.req.param("mac");
    const position = this.positioningSystem.getPosition(mac);
    if (position) {
      return ctx.json(position);
    } else {
      return ctx.json({ message: "Position not found" }, 404);
    }
  }

  async setWebSocketContext(ctx: WSContext) {
    this.positioningSystem.setWebSocketContext(ctx);
    return ctx.send(
      JSON.stringify({ message: "WebSocket context set successfully" }),
    );
  }
}
