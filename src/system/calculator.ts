import { WSContext } from "hono/ws";
import mqtt from "mqtt";
import { updateDeviceStatus } from "../service/deviceService";
import { addAlert } from "../service/alertsService";

export class PositioningSystem {
  private ws: WSContext | undefined;
  private readonly brokerUrl = process.env.brokerUrl || "mqtt://localhost";
  private readonly pythonApiUrl =
    process.env.pythonApiUrl || "http://localhost:5000";
  private readonly client = mqtt.connect(this.brokerUrl);
  private readonly offlineTimeout = 30000;
  private readonly offlineCheckInterval = 30000;
  private readonly alarmCooldown = 5000; // Cooldown period for alarm retriggering (ms)
  private targetMacs: Set<string> = new Set();
  private lastSeenTimestamps: { [mac: string]: number } = {};
  private lastAlertTimestamps: { [mac: string]: number } = {};
  private deviceIdMap: { [mac: string]: number } = {};
  private deviceNameMap: { [mac: string]: string } = {};
  private activeAlerts: Set<string> = new Set(); // Tracks MACs with active alerts
  private alarmTimeout: NodeJS.Timeout | null = null; // Tracks active alarm timeout

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
    // Clear alerts for MACs no longer in deviceIdMap
    Array.from(this.activeAlerts).forEach((mac) => {
      if (!(mac.toLowerCase() in this.deviceIdMap)) {
        this.activeAlerts.delete(mac);
      }
    });
    this.checkAlarmStatus();
  }

  private setupMQTT() {
    this.client.on("connect", () => {
      console.log("Connected to MQTT broker");
      [
        "esp32_1/rssi",
        "esp32_2/rssi",
        "esp32_3/rssi",
        "esp32_4/rssi",
        "rtls/position_status",
        "training/status",
      ].forEach((topic) =>
        this.client.subscribe(topic, (err) => {
          if (err) console.error(`Failed to subscribe to ${topic}:`, err);
        }),
      );
    });

    this.client.on("message", (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        if (topic === "training/status") {
          const { mac, progress } = data;
          if (mac && progress !== undefined) {
            this.sendAlert(
              mac.toUpperCase(),
              `Training progress: ${progress}%`,
              "training_progress",
            );
          }
          return;
        }

        if (topic === "rtls/position_status") {
          const { mac, status, confidence } = data;
          if (mac && status) {
            const isLocked = status === "locked";
            const alertType = isLocked
              ? "positioning_status_locked"
              : "positioning_status_not_locked";

            // Manage active alerts for positioning status
            if (!isLocked) {
              this.activeAlerts.add(mac);
            } else {
              this.activeAlerts.delete(mac);
            }
            this.checkAlarmStatus();

            this.sendAlert(
              mac.toUpperCase(),
              `Positioning status: ${status} (Confidence: ${confidence.toFixed(2)})`,
              alertType,
            );
          }
          return;
        }

        const { mac, rssi, esp } = data;
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

  private async sendAlert(mac: string, message: string, type: string) {
    const now = Date.now();
    const lastAlert = this.lastAlertTimestamps[mac] || 0;
    if (
      now - lastAlert < 2500 &&
      type !== "offline_alert" &&
      type !== "training_progress"
    ) {
      return;
    }

    this.lastAlertTimestamps[mac] = now;
    const deviceId = this.deviceIdMap[mac.toLowerCase()];
    const name = this.deviceNameMap[mac.toLowerCase()] || mac;
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

    // Trigger alarm if there are active alerts
    if (type === "positioning_status_not_locked" || type === "offline_alert") {
      this.triggerAlarm();
    }
  }

  private startOfflineChecker() {
    setInterval(() => {
      const now = Date.now();
      Array.from(this.targetMacs).forEach((mac) => {
        const lastSeen = this.lastSeenTimestamps[mac] || 0;
        if (now - lastSeen > this.offlineTimeout) {
          this.activeAlerts.add(mac);
          this.sendAlert(
            mac,
            `${this.deviceNameMap[mac]} is offline for extended period`,
            "offline_alert",
          );
          this.triggerAlarm();
        } else if (this.lastSeenTimestamps[mac]) {
          // If device is back online, remove offline alert
          this.activeAlerts.delete(mac);
          this.checkAlarmStatus();
        }
      });
    }, this.offlineCheckInterval);
  }

  private triggerAlarm() {
    if (!this.alarmTimeout && this.activeAlerts.size > 0) {
      console.log("🚨 Triggering alarm due to active alerts");
      fetch("http://192.168.195.149:3030/blinkLED")
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        })
        .catch((err) => console.error("Alarm fetch error:", err));
      this.alarmTimeout = setTimeout(() => {
        this.alarmTimeout = null;
        if (this.activeAlerts.size > 0) {
          this.triggerAlarm();
        }
      }, this.alarmCooldown);
    }
  }

  private checkAlarmStatus() {
    if (this.activeAlerts.size === 0) {
      this.stopAlarm();
    }
  }

  private stopAlarm() {
    if (this.alarmTimeout) {
      console.log("🛑 Stopping alarm - all issues resolved");
      clearTimeout(this.alarmTimeout);
      this.alarmTimeout = null;
      fetch("http://192.168.195.149:3030/stopBlink")
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        })
        .catch((err) => console.error("Stop alarm fetch error:", err));
    }
  }

  public async connectToPythonSystem(
    action: "train" | "refresh",
    mac?: string,
  ) {
    try {
      if (action === "train" && !mac) {
        throw new Error("MAC address is required for training");
      }

      let url: string;
      let method = "POST";
      let alertMessage: string;

      if (action === "train" && mac) {
        const normalizedMac = mac.toLowerCase();
        if (!this.targetMacs.has(normalizedMac)) {
          throw new Error(`MAC ${mac} is not in target devices`);
        }
        url = `${this.pythonApiUrl}/train/${encodeURIComponent(normalizedMac)}`;
        alertMessage = `Training requested for ${this.deviceNameMap[normalizedMac] || mac}`;
      } else {
        url = `${this.pythonApiUrl}/refresh_devices`;
        alertMessage = "Device list refresh requested";
      }

      const response = await fetch(url, { method });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to perform action");
      }

      await this.sendAlert(
        mac?.toUpperCase() || "system",
        `${alertMessage}: ${data.message}`,
        action === "train" ? "training_initiated" : "devices_refreshed",
      );

      if (action === "refresh" && data.target_macs) {
        this.updateTargetMacs(data.target_macs);
        await this.sendAlert(
          "system",
          `Updated target MACs: ${data.target_macs.join(", ")}`,
          "devices_updated",
        );
      }

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await this.sendAlert(
        mac?.toUpperCase() || "system",
        `Failed to ${action === "train" ? "train device" : "refresh devices"}: ${errorMessage}`,
        `${action}_error`,
      );
      throw err;
    }
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
    // Clear alerts for MACs no longer in targetMacs
    Array.from(this.activeAlerts).forEach((mac) => {
      if (!this.targetMacs.has(mac.toLowerCase())) {
        this.activeAlerts.delete(mac);
      }
    });
    this.checkAlarmStatus();
  }

  public updateTargetMacs(macs: string[]) {
    macs
      .map((mac) => mac.toLowerCase())
      .filter((mac) => mac in this.deviceIdMap)
      .forEach((mac) => this.targetMacs.add(mac));
    // Clear alerts for MACs no longer in targetMacs
    Array.from(this.activeAlerts).forEach((mac) => {
      if (!this.targetMacs.has(mac.toLowerCase())) {
        this.activeAlerts.delete(mac);
      }
    });
    this.checkAlarmStatus();
  }
}
