import { WSContext } from "hono/ws";
import mqtt from "mqtt";
import { updateDeviceStatus } from "../service/deviceService";
import { addAlert } from "../service/alertsService";

interface AnchorRSSI {
  [anchorId: number]: number;
}

interface Position {
  x: number;
  y: number;
}

export class PositioningSystem {
  private ws: WSContext | undefined;
  private readonly brokerUrl = "mqtt://192.168.195.149";
  private readonly client = mqtt.connect(this.brokerUrl);
  private readonly smoothingFactor = 1;
  private readonly minAnchors = 4;
  private readonly movementThreshold = 0.15;

  private readonly anchorPositions: { [id: number]: Position } = {
    1: { x: 0, y: 3 },
    2: { x: 0.5, y: 3 },
    3: { x: 0, y: 3 },
    4: { x: 0.5, y: 3 },
  };

  private targetMacs: Set<string> = new Set();
  private beaconRSSI: { [mac: string]: AnchorRSSI } = {};
  private smoothedPositions: { [mac: string]: Position } = {};
  private externalSavedPositions: { [mac: string]: Position } = {};
  private lastSeenTimestamps: { [mac: string]: number } = {};
  private readonly offlineTimeout = 30000; // 60 seconds
  private readonly offlineCheckInterval = 30000; // 30 seconds
  private violationCounts: { [mac: string]: number } = {};
  private readonly maxViolationsBeforeAlert = 3;
  private deviceIdMap: { [mac: string]: number } = {};
  private deviceNameMap: { [mac: string]: string } = {};
  private alarmTimeout: NodeJS.Timeout | null = null;
  private readonly alarmCooldown = 10000;
  private activeAlerts: Set<string> = new Set();

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
        if (device.name) {
          this.deviceNameMap[mac] = device.name;
        }
      }
    });
    console.log("Device ID map updated:", this.deviceIdMap);
  }

  private setupMQTT() {
    this.client.on("connect", () => {
      console.log("Connected to MQTT broker");
      ["esp32_1/rssi", "esp32_2/rssi", "esp32_3/rssi", "esp32_4/rssi"].forEach(
        (topic) => this.client.subscribe(topic),
      );
    });

    this.client.on("message", (_topic, message) => {
      try {
        const { mac, rssi, esp } = JSON.parse(message.toString());
        const normalizedMac = mac.toLowerCase();

        if (
          !this.targetMacs.has(normalizedMac) ||
          !(normalizedMac in this.deviceIdMap)
        )
          return;
        console.log(`Received RSSI for ${normalizedMac}: ${rssi} from ${esp}`);

        if (!this.beaconRSSI[normalizedMac])
          this.beaconRSSI[normalizedMac] = {};
        this.beaconRSSI[normalizedMac][esp] = rssi;

        this.lastSeenTimestamps[normalizedMac] = Date.now();

        if (
          Object.keys(this.beaconRSSI[normalizedMac]).length >= this.minAnchors
        ) {
          console.log(normalizedMac, this.beaconRSSI[normalizedMac]);
          this.processPosition(normalizedMac);
        }
      } catch (err) {
        console.error("MQTT message error:", err);
      }
    });
  }

  private async triggerAlert(mac: string, message: string, type: string) {
    const deviceId = this.deviceIdMap[mac];
    const name = this.deviceNameMap[mac] || mac;
    const alertMessage = `Device ${name}: ${message}`;

    await updateDeviceStatus(mac, type);

    if (deviceId) {
      await addAlert(deviceId, alertMessage, type);
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

    // Add to active alerts if it's an alert type (not a recovery)
    if (type === "alert" || type === "offline_alert") {
      this.activeAlerts.add(mac);
      this.triggerAlarm();
    } else if (type === "position_recovered") {
      this.activeAlerts.delete(mac);
      this.checkAlarmStatus();
    }
  }

  private startOfflineChecker() {
    setInterval(() => {
      const now = Date.now();
      Array.from(this.targetMacs).forEach(async (mac) => {
        const lastSeen = this.lastSeenTimestamps[mac];
        if (!lastSeen || now - lastSeen > this.offlineTimeout) {
          this.triggerAlert(
            mac,
            `${this.deviceNameMap[mac]} is offline for extended period`,
            "offline_alert",
          );
          this.violationCounts[mac] = 0;
        }
      });
    }, this.offlineCheckInterval);
  }

  private async processPosition(mac: string) {
    const newPos = this.estimatePosition(this.beaconRSSI[mac]);
    if (!newPos) return;

    if (!this.smoothedPositions[mac]) {
      this.smoothedPositions[mac] = newPos;
    } else {
      this.smoothedPositions[mac].x =
        this.smoothingFactor * newPos.x +
        (1 - this.smoothingFactor) * this.smoothedPositions[mac].x;
      this.smoothedPositions[mac].y =
        this.smoothingFactor * newPos.y +
        (1 - this.smoothingFactor) * this.smoothedPositions[mac].y;
    }

    const currentPos = this.smoothedPositions[mac];
    const savedPos = this.externalSavedPositions[mac];

    console.log(
      `Beacon ${this.deviceNameMap[mac] || mac} at (x: ${currentPos.x.toFixed(2)}, y: ${currentPos.y.toFixed(2)})`,
    );

    if (savedPos) {
      const distance = this.calculateDistance(currentPos, savedPos);
      if (distance > this.movementThreshold) {
        console.log(
          `⚠️ Device ${this.deviceNameMap[mac] || mac} moved ${distance.toFixed(2)}m from saved position!`,
        );
        this.violationCounts[mac] = (this.violationCounts[mac] || 0) + 1;

        if (this.violationCounts[mac] >= this.maxViolationsBeforeAlert) {
          this.triggerAlert(
            mac,
            `${this.deviceNameMap[mac]} moved ${distance.toFixed(2)}m from saved position`,
            "alert",
          );
          this.violationCounts[mac] = 0;
        }
      } else {
        this.violationCounts[mac] = 0;
        if (this.activeAlerts.has(mac)) {
          this.triggerAlert(
            mac,
            `${this.deviceNameMap[mac]} is back in position`,
            "position_recovered",
          );
        } else {
          if (this.ws) {
            this.ws.send(
              JSON.stringify({
                type: "position_recovered",
                mac: mac.toUpperCase(),
                message: `${this.deviceNameMap[mac] || mac} is back in position`,
                timestamp: new Date().toISOString(),
              }),
            );
          }
        }
      }
    }
  }

  private estimatePosition(rssiMap: AnchorRSSI): Position | null {
    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;

    for (const [anchorIdStr, rssi] of Object.entries(rssiMap)) {
      const anchorId = Number(anchorIdStr);
      const pos = this.anchorPositions[anchorId];
      if (!pos) continue;

      const weight = Math.pow(10, rssi / 10);
      totalWeight += weight;
      weightedX += pos.x * weight;
      weightedY += pos.y * weight;
    }

    return totalWeight > 0
      ? { x: weightedX / totalWeight, y: weightedY / totalWeight }
      : null;
  }

  private calculateDistance(pos1: Position, pos2: Position): number {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    return Math.sqrt(dx * dx + dy * dy);
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

  public setSavedPositions(saved: { [mac: string]: Position }) {
    this.externalSavedPositions = { ...saved };
  }

  public getAllPositions(): { [mac: string]: Position } {
    return { ...this.smoothedPositions };
  }

  public getPosition(mac: string): Position | null {
    const normMac = mac.toLowerCase();
    return this.smoothedPositions[normMac] || null;
  }

  private triggerAlarm() {
    if (!this.alarmTimeout && this.activeAlerts.size > 0) {
      console.log("🚨 Triggering alarm due to active alerts");
      fetch("http://192.168.195.149:3030/blinkLED").catch((err) =>
        console.error("Alarm fetch error:", err),
      );
      this.alarmTimeout = setTimeout(() => {
        this.alarmTimeout = null;
        // Continue alarm if there are still active alerts
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
      fetch("http://192.168.195.149:3030/stopBlink").catch((err) =>
        console.error("Stop alarm fetch error:", err),
      );
    }
  }
}
