import { WSContext } from "hono/ws";
import mqtt from "mqtt";
import { updateDeviceStatus } from "../service/deviceService";
import { addAlert } from "../service/alertsService";

export class PositioningSystem {
  private ws: WSContext | undefined;
  private readonly brokerUrl = process.env.brokerUrl || "mqtt://localhost";
  private readonly client = mqtt.connect(this.brokerUrl);
  private readonly offlineTimeout = 30000;
  private readonly offlineCheckInterval = 30000;
  private targetMacs: Set<string> = new Set();
  private lastSeenTimestamps: { [mac: string]: number } = {};
  private lastAlertTimestamps: { [mac: string]: number } = {};
  private deviceIdMap: { [mac: string]: number } = {};
  private deviceNameMap: { [mac: string]: string } = {};

  constructor() {
    this.setupMQTT();
    this.startOfflineChecker();
  }

  public setDeviceIdMap(
    devices: { id: number; mac: string; name?: string; enable: boolean }[],
  ) {
    this.deviceIdMap = {};
    this.deviceNameMap = {};
    devices.forEach((device) => {
      if (device.enable) {
        const mac = device.mac.toLowerCase();
        this.deviceIdMap[mac] = device.id;
        this.deviceNameMap[mac] = device.name || mac;
      }
    });
    console.log("Device ID map updated:", this.deviceIdMap);
  }

  private setupMQTT() {
    this.client.on("connect", () => {
      console.log("Connected to MQTT broker");
      ["esp32_1/rssi", "esp32_2/rssi", "esp32_3/rssi"].forEach((topic) =>
        this.client.subscribe(topic, (err) => {
          if (err) console.error(`Failed to subscribe to ${topic}:`, err);
        }),
      );
    });

    this.client.on("message", (topic, message) => {
      try {
        const { mac, rssi, esp } = JSON.parse(message.toString());
        const normalizedMac = mac.toLowerCase();

        if (
          !this.targetMacs.has(normalizedMac) ||
          !(normalizedMac in this.deviceIdMap)
        )
          return;

        console.log(`Received RSSI for ${normalizedMac}: ${rssi} from ${esp}`);

        this.lastSeenTimestamps[normalizedMac] = Date.now();
      } catch (err) {
        console.error("MQTT message error:", err);
      }
    });
  }

  private async triggerAlert(mac: string, message: string, type: string) {
    const now = Date.now();
    const lastAlert = this.lastAlertTimestamps[mac] || 0;
    if (now - lastAlert < 2500 && type !== "offline_alert") {
      return;
    }

    this.lastAlertTimestamps[mac] = now;
    const deviceId = this.deviceIdMap[mac];
    const name = this.deviceNameMap[mac];
    const alertMessage = `Device ${name}: ${message}`;

    await updateDeviceStatus(mac.toUpperCase(), type).catch((err) =>
      console.error(`Failed to update device status for ${mac}:`, err),
    );

    if (deviceId) {
      await addAlert(deviceId, alertMessage, type).catch((err) =>
        console.error(`Failed to add alert for ${mac}:`, err),
      );
    }

    if (this.ws) {
      this.ws.send(
        JSON.stringify({
          type,
          mac: mac.toUpperCase(),
          message: alertMessage,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    console.warn(`⚠️ ALERT: ${alertMessage}`);
  }

  private startOfflineChecker() {
    setInterval(() => {
      const now = Date.now();
      Array.from(this.targetMacs).forEach((mac) => {
        const lastSeen = this.lastSeenTimestamps[mac] || 0;
        if (now - lastSeen > this.offlineTimeout) {
          this.triggerAlert(
            mac,
            `${this.deviceNameMap[mac]} is offline for extended period`,
            "offline_alert",
          );
        }
      });
    }, this.offlineCheckInterval);
  }

  public setWebSocketContext(ws: WSContext) {
    this.ws = ws;
  }

  public setTargetMacs(macs: string[]) {
    this.targetMacs = new Set(
      macs
        .map((mac) => mac.toLowerCase())
        .filter((mac) => mac in this.deviceIdMap),
    );
  }

  public updateTargetMacs(macs: string[]) {
    macs
      .map((mac) => mac.toLowerCase())
      .filter((mac) => mac in this.deviceIdMap)
      .forEach((mac) => this.targetMacs.add(mac));
  }
}
