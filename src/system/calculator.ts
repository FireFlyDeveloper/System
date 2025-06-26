import { WSContext } from "hono/ws";
import mqtt from "mqtt";
import { updateDeviceStatus } from "../service/deviceService";
import { addAlert } from "../service/alertsService";

export class PositioningSystem {
  // ==================== Configuration Properties ====================
  private readonly brokerUrl = process.env.brokerUrl || "mqtt://localhost";
  private readonly pythonApiUrl = process.env.pythonApiUrl || "http://localhost:5000";
  private readonly offlineTimeout = 30000;
  private readonly offlineCheckInterval = 30000;
  private readonly alarmCooldown = 5000;

  // ==================== State Properties ====================
  private ws: WSContext | undefined;
  private readonly client = mqtt.connect(this.brokerUrl);
  private targetMacs: Set<string> = new Set();
  private activeAlerts: Set<string> = new Set();
  private alarmTimeout: NodeJS.Timeout | null = null;

  // ==================== Tracking Maps ====================
  private lastSeenTimestamps: Record<string, number> = {};
  private deviceIdMap: Record<string, number> = {};
  private deviceNameMap: Record<string, string> = {};
  private currentStatuses: Record<string, string> = {};

  constructor() {
    this.setupMQTT();
    this.startOfflineChecker();
  }

  // ==================== Public Methods ====================
  public setDeviceIdMap(devices: { id: number; mac: string; name?: string; enable: boolean, status: string }[]) {
    this.deviceIdMap = {};
    this.deviceNameMap = {};
    this.currentStatuses = {};

    console.log(devices);
    
    devices.forEach((device) => {
      if (device.enable && device.status !== "not-configured") {
        const mac = device.mac.toLowerCase();
        this.deviceIdMap[mac] = device.id;
        this.deviceNameMap[mac] = device.name || mac;
        this.currentStatuses[mac] = device.status;
      }
    });

    this.cleanupActiveAlerts();
    this.checkAlarmStatus();
  }

  public setWebSocketContext(ws: WSContext) {
    this.ws = ws;
  }

  public setTargetMacs(macs: string[]) {
    this.targetMacs = new Set(
      macs.map(mac => mac.toLowerCase())
          .filter(mac => mac in this.deviceIdMap)
    );
    this.cleanupActiveAlerts();
    this.checkAlarmStatus();
  }

  public updateTargetMacs(macs: string[]) {
    macs.map(mac => mac.toLowerCase())
        .filter(mac => mac in this.deviceIdMap)
        .forEach(mac => this.targetMacs.add(mac));
    this.cleanupActiveAlerts();
    this.checkAlarmStatus();
  }

  public async connectToPythonSystem(action: "train" | "refresh", mac?: string) {
    try {
      if (action === "train" && !mac) {
        throw new Error("MAC address is required for training");
      }

      const { url, alertMessage } = this.getPythonSystemConfig(action, mac);
      const response = await fetch(url, { method: "GET" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to perform action");
      }

      await this.handlePythonSystemResponse(action, mac, data, alertMessage);
      return data;
    } catch (err) {
      await this.handlePythonSystemError(action, err, mac);
      throw err;
    }
  }

  // ==================== MQTT Methods ====================
  private setupMQTT() {
    this.client.on("connect", () => {
      console.log("Connected to MQTT broker");
      this.subscribeToTopics([
        "esp32_1/rssi", "esp32_2/rssi", "esp32_3/rssi", "esp32_4/rssi",
        "rtls/position_status", "training/status"
      ]);
    });

    this.client.on("message", (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        this.handleMQTTMessage(topic, data);
      } catch (err) {
        console.error("MQTT message error:", err);
      }
    });
  }

  private subscribeToTopics(topics: string[]) {
    topics.forEach(topic => {
      this.client.subscribe(topic, (err) => {
        if (err) console.error(`Failed to subscribe to ${topic}:`, err);
      });
    });
  }

  private handleMQTTMessage(topic: string, data: any) {
    if (topic === "training/status") {
      this.handleTrainingStatus(data);
      return;
    }

    if (topic === "rtls/position_status") {
      this.handlePositionStatus(data);
      return;
    }

    this.handleRSSIData(data);
  }

  private handleTrainingStatus({ mac, progress }: { mac?: string; progress?: number }) {
    if (mac && progress !== undefined) {
      this.sendAlert(
        mac.toUpperCase(),
        `Training progress: ${progress}%`,
        "training_progress"
      );
    }
  }

  private handlePositionStatus({ mac, status, confidence }: { mac?: string; status?: string; confidence?: number }) {
    if (mac && status) {
      const isLocked = status === "locked";
      const alertType = isLocked ? "in-position" : "warning";

      if (!isLocked) {
        this.activeAlerts.add(mac);
      } else {
        this.activeAlerts.delete(mac);
      }

      this.checkAlarmStatus();
      this.sendAlert(
        mac.toUpperCase(),
        `Positioning status: ${status} (Confidence: ${confidence?.toFixed(2)})`,
        alertType
      );
    }
  }

  private handleRSSIData({ mac, rssi, esp }: { mac?: string; rssi?: number; esp?: string }) {
    if (!mac) return;

    const normalizedMac = mac.toLowerCase();
    if (!this.targetMacs.has(normalizedMac) || !(normalizedMac in this.deviceIdMap)) return;

    console.log(`Received RSSI for ${normalizedMac}: ${rssi} from ${esp}`);
    this.lastSeenTimestamps[normalizedMac] = Date.now();
  }

  // ==================== Alert Methods ====================
  private async sendAlert(mac: string, message: string, type: string) {
    const normalizedMac = mac.toLowerCase();
    const deviceId = this.deviceIdMap[normalizedMac];
    const name = this.deviceNameMap[normalizedMac] || mac;
    const alertMessage = `Device ${name}: ${message}`;

    // Only update status if it has changed
    if (this.currentStatuses[mac] !== type) {
      await this.updateDeviceStatus(mac, type);
      this.currentStatuses[mac] = type;
    }

    // Always add alert to history
    if (deviceId) {
      await addAlert(deviceId, alertMessage, type)
        .catch(err => console.error(`Failed to add alert for ${mac}:`, err));
    }

    // Send to websocket if available
    if (this.ws) {
      this.ws.send(JSON.stringify({
        type,
        mac: mac.toUpperCase(),
        message: alertMessage,
        timestamp: new Date().toISOString()
      }));
    }

    console.warn(`⚠️ ALERT: ${alertMessage}`);

    // Trigger alarm if needed
    if (type === "warning" || type === "critical") {
      this.triggerAlarm();
    }
  }

  private async updateDeviceStatus(mac: string, type: string) {
    try {
      await updateDeviceStatus(mac.toUpperCase(), type);
    } catch (err) {
      console.error(`Failed to update device status for ${mac}:`, err);
    }
  }

  // ==================== Alarm Methods ====================
  private triggerAlarm() {
    if (this.alarmTimeout || this.activeAlerts.size === 0) return;

    console.log("🚨 Triggering alarm due to active alerts");
    fetch("http://192.168.195.149:3030/blinkLED")
      .catch(err => console.error("Alarm fetch error:", err));

    this.alarmTimeout = setTimeout(() => {
      this.alarmTimeout = null;
      if (this.activeAlerts.size > 0) this.triggerAlarm();
    }, this.alarmCooldown);
  }

  private stopAlarm() {
    if (!this.alarmTimeout) return;

    console.log("🛑 Stopping alarm - all issues resolved");
    clearTimeout(this.alarmTimeout);
    this.alarmTimeout = null;
    fetch("http://192.168.195.149:3030/stopBlink")
      .catch(err => console.error("Stop alarm fetch error:", err));
  }

  private checkAlarmStatus() {
    if (this.activeAlerts.size === 0) {
      this.stopAlarm();
    }
  }

  // ==================== Offline Checker ====================
  private startOfflineChecker() {
    setInterval(() => {
      const now = Date.now();
      Array.from(this.targetMacs).forEach(mac => {
        const lastSeen = this.lastSeenTimestamps[mac] || 0;
        
        if (now - lastSeen > this.offlineTimeout) {
          this.handleOfflineDevice(mac);
        } else if (this.lastSeenTimestamps[mac]) {
          this.handleOnlineDevice(mac);
        }
      });
    }, this.offlineCheckInterval);
  }

  private handleOfflineDevice(mac: string) {
    this.activeAlerts.add(mac);
    this.sendAlert(
      mac,
      `${this.deviceNameMap[mac]} is offline for extended period`,
      "critical"
    );
    this.triggerAlarm();
  }

  private handleOnlineDevice(mac: string) {
    this.activeAlerts.delete(mac);
    this.checkAlarmStatus();
  }

  // ==================== Helper Methods ====================
  private cleanupActiveAlerts() {
    Array.from(this.activeAlerts).forEach(mac => {
      if (!this.targetMacs.has(mac.toLowerCase())) {
        this.activeAlerts.delete(mac);
      }
    });
  }

  private getPythonSystemConfig(action: "train" | "refresh", mac?: string) {
    if (action === "train" && mac) {
      const normalizedMac = mac.toLowerCase();
      return {
        url: `${this.pythonApiUrl}/train/${encodeURIComponent(normalizedMac)}`,
        alertMessage: `Training requested for ${this.deviceNameMap[normalizedMac] || mac}`
      };
    }
    return {
      url: `${this.pythonApiUrl}/refresh_devices`,
      alertMessage: "Device list refresh requested"
    };
  }

  private async handlePythonSystemResponse(
    action: "train" | "refresh",
    mac: string | undefined,
    data: any,
    alertMessage: string
  ) {
    await this.sendAlert(
      mac?.toUpperCase() || "system",
      `${alertMessage}: ${data.message}`,
      action === "train" ? "training_initiated" : "devices_refreshed"
    );

    if (action === "refresh" && data.target_macs) {
      this.updateTargetMacs(data.target_macs);
    }
  }

  private async handlePythonSystemError(
    action: "train" | "refresh",
    error: unknown,
    mac?: string
  ) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to ${action === "train" ? "train device" : "refresh devices"}: ${errorMessage}`);
  }
}