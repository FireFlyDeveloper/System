import { WSContext } from "hono/ws";
import mqtt from "mqtt";
import { updateDeviceStatus } from "../service/deviceService";
import { addAlert } from "../service/alertsService";

interface AnchorData {
  rssi: number;
  timestamp: number;
}

interface Position {
  x: number;
  y: number;
}

// Kalman Filter for RSSI smoothing
class KalmanFilter {
  private x: number; // Estimated RSSI
  private P: number; // Estimate uncertainty
  private R: number; // Process noise covariance
  private Q: number; // Measurement noise covariance

  constructor(initialRssi: number) {
    this.x = initialRssi;
    this.P = 1.0;
    this.R = 0.01; // Small for stationary devices
    this.Q = 1.0; // Tighter smoothing for BLE RSSI (~1 dBm std dev)
  }

  public update(measurement: number): number {
    // Predict
    const x_pred = this.x;
    const P_pred = this.P + this.R;

    // Update
    const K = P_pred / (P_pred + this.Q); // Kalman gain
    this.x = x_pred + K * (measurement - x_pred);
    this.P = (1 - K) * P_pred;

    return this.x;
  }
}

export class PositioningSystem {
  private ws: WSContext | undefined;
  private readonly brokerUrl = process.env.brokerUrl || "mqtt://localhost";
  private readonly client = mqtt.connect(this.brokerUrl);
  private readonly minAnchors = 3; // Minimum for 2D trilateration
  private readonly movementThreshold = 0.5; // Meters for movement detection
  private readonly maxSignalAge = 3000; // Max signal age in ms
  private readonly alertCooldown = 5000; // Cooldown for alerts in ms
  private readonly maxViolationsBeforeAlert = 5; // Consecutive violations before alert

  // Anchor positions
  private readonly anchorPositions: { [id: number]: Position } = {
    1: { x: 0, y: 0 },
    2: { x: 5, y: 0 },
    3: { x: 0, y: 5 },
  };

  // BLE signal propagation constants (adjust based on environment)
  private readonly txPower = -65; // RSSI at 1 meter (calibrate empirically)
  private readonly pathLossExponent = 2.7; // Adjusted for indoor environment

  private targetMacs: Set<string> = new Set();
  private beaconData: { [mac: string]: { [anchorId: number]: AnchorData[] } } =
    {};
  private kalmanFilters: {
    [mac: string]: { [anchorId: number]: KalmanFilter };
  } = {};
  private currentPositions: { [mac: string]: Position } = {};
  private externalSavedPositions: { [mac: string]: Position } = {};
  private lastSeenTimestamps: { [mac: string]: number } = {};
  private lastAlertTimestamps: { [mac: string]: number } = {};
  private violationCounts: { [mac: string]: number } = {};
  private readonly offlineTimeout = 30000;
  private readonly offlineCheckInterval = 30000;
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
        const anchorId = parseInt(esp);

        if (
          !this.targetMacs.has(normalizedMac) ||
          !(normalizedMac in this.deviceIdMap)
        )
          return;

        console.log(`Received RSSI for ${normalizedMac}: ${rssi} from ${esp}`);

        if (!this.beaconData[normalizedMac]) {
          this.beaconData[normalizedMac] = {};
          this.kalmanFilters[normalizedMac] = {};
        }
        if (!this.beaconData[normalizedMac][anchorId]) {
          this.beaconData[normalizedMac][anchorId] = [];
        }
        if (!this.kalmanFilters[normalizedMac][anchorId]) {
          this.kalmanFilters[normalizedMac][anchorId] = new KalmanFilter(rssi);
        }

        this.beaconData[normalizedMac][anchorId].push({
          rssi,
          timestamp: Date.now(),
        });

        // Update Kalman filter
        this.kalmanFilters[normalizedMac][anchorId].update(rssi);

        this.lastSeenTimestamps[normalizedMac] = Date.now();
        this.processPosition(normalizedMac);
      } catch (err) {
        console.error("MQTT message error:", err);
      }
    });
  }

  private async triggerAlert(mac: string, message: string, type: string) {
    const now = Date.now();
    const lastAlert = this.lastAlertTimestamps[mac] || 0;
    if (now - lastAlert < this.alertCooldown && type !== "offline_alert") {
      return; // Skip alert during cooldown
    }

    this.lastAlertTimestamps[mac] = now;
    const deviceId = this.deviceIdMap[mac];
    const name = this.deviceNameMap[mac];
    const alertMessage = `Device ${name}: ${message}`;

    await updateDeviceStatus(mac, type).catch((err) =>
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

    if (type === "alert" || type === "offline_alert") {
      this.activeAlerts.add(mac);
      this.triggerAlarm();
    } else if (type === "position_recovered") {
      this.activeAlerts.delete(mac);
      this.violationCounts[mac] = 0; // Reset violations on recovery
      this.checkAlarmStatus();
    }
  }

  private startOfflineChecker() {
    setInterval(() => {
      const now = Date.now();
      Array.from(this.targetMacs).forEach((mac) => {
        const lastSeen = this.lastSeenTimestamps[mac] || 0;
        if (now - lastSeen > this.offlineTimeout) {
          this.violationCounts[mac] = 0; // Reset violations on offline
          this.triggerAlert(
            mac,
            `${this.deviceNameMap[mac]} is offline for extended period`,
            "offline_alert",
          );
        }
      });
    }, this.offlineCheckInterval);
  }

  private async processPosition(mac: string) {
    this.cleanOldData(mac);

    const anchorCount = Object.values(this.beaconData[mac] || {}).filter(
      (arr) => arr.length > 0,
    ).length;
    if (anchorCount < this.minAnchors) {
      console.log(`Not enough fresh data for ${mac} (${anchorCount} anchors)`);
      return;
    }

    const newPos = this.trilateratePosition(mac);
    if (!newPos) {
      console.log(`Failed to trilaterate position for ${mac}`);
      return;
    }

    // Strict bounds check
    if (newPos.x < 0 || newPos.x > 5 || newPos.y < 0 || newPos.y > 5) {
      console.log(
        `Position out of bounds for ${mac}: (x: ${newPos.x.toFixed(
          2,
        )}, y: ${newPos.y.toFixed(2)})`,
      );
      return;
    }

    this.currentPositions[mac] = newPos;
    console.log(
      `Beacon ${this.deviceNameMap[mac]} at (x: ${newPos.x.toFixed(
        2,
      )}, y: ${newPos.y.toFixed(2)})`,
    );

    const savedPos = this.externalSavedPositions[mac];
    if (savedPos) {
      console.log(
        `Saved position for ${mac}: (x: ${savedPos.x.toFixed(
          2,
        )}, y: ${savedPos.y.toFixed(2)})`,
      );
      const distance = this.calculateDistance(newPos, savedPos);
      if (distance > this.movementThreshold) {
        this.violationCounts[mac] = (this.violationCounts[mac] || 0) + 1;
        console.log(
          `⚠️ Device ${this.deviceNameMap[mac]} moved ${distance.toFixed(
            2,
          )}m from saved position! (Violation ${this.violationCounts[mac]}/${
            this.maxViolationsBeforeAlert
          })`,
        );

        if (this.violationCounts[mac] >= this.maxViolationsBeforeAlert) {
          this.triggerAlert(
            mac,
            `Moved ${distance.toFixed(2)}m from saved position`,
            "alert",
          );
          this.violationCounts[mac] = 0; // Reset after alert
        }
      } else {
        this.violationCounts[mac] = 0; // Reset violations if within threshold
        if (this.activeAlerts.has(mac)) {
          this.triggerAlert(mac, `Is back in position`, "position_recovered");
        } else if (this.ws) {
          this.ws.send(
            JSON.stringify({
              type: "position_recovered",
              mac: mac.toUpperCase(),
              message: `${this.deviceNameMap[mac]} is back in position`,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    }
  }

  private cleanOldData(mac: string) {
    const now = Date.now();
    const data = this.beaconData[mac];
    if (data) {
      for (const anchorIdStr of Object.keys(data)) {
        const anchorId = parseInt(anchorIdStr);
        data[anchorId] = data[anchorId].filter(
          (d) => now - d.timestamp <= this.maxSignalAge,
        );
        if (data[anchorId].length === 0) {
          delete data[anchorId];
          delete this.kalmanFilters[mac]?.[anchorId];
        }
      }
      if (Object.keys(data).length === 0) {
        delete this.beaconData[mac];
        delete this.kalmanFilters[mac];
      }
    }
  }

  private rssiToDistance(rssi: number): number {
    const distance = Math.pow(
      10,
      (this.txPower - rssi) / (10 * this.pathLossExponent),
    );
    // Clamp distance to prevent unrealistic values
    return Math.max(0.1, Math.min(distance, 10));
  }

  private trilateratePosition(mac: string): Position | null {
    const anchorData = this.beaconData[mac];
    if (!anchorData) return null;

    const anchors = Object.entries(anchorData)
      .filter(([_, dataArray]) => dataArray.length > 0)
      .map(([anchorIdStr, dataArray]) => {
        const anchorId = parseInt(anchorIdStr);
        const latestRssi = dataArray[dataArray.length - 1].rssi;
        const smoothedRssi =
          this.kalmanFilters[mac][anchorId].update(latestRssi);
        const distance = this.rssiToDistance(smoothedRssi);
        return {
          position: this.anchorPositions[anchorId],
          distance,
        };
      });

    if (anchors.length < this.minAnchors) return null;

    // Initial guess: centroid of anchor positions
    let x = 0,
      y = 0;
    for (const { position } of anchors) {
      x += position.x;
      y += position.y;
    }
    x /= anchors.length;
    y /= anchors.length;

    // Gradient descent with bounds
    const learningRate = 0.01;
    const maxIterations = 1000;
    const tolerance = 0.0001;

    for (let iter = 0; iter < maxIterations; iter++) {
      let dxSum = 0,
        dySum = 0;
      let error = 0;

      for (const {
        position: { x: x_i, y: y_i },
        distance: d_i,
      } of anchors) {
        const dist = Math.sqrt((x - x_i) ** 2 + (y - y_i) ** 2) || 0.0001;
        const grad_x = (x - x_i) * (1 - d_i / dist);
        const grad_y = (y - y_i) * (1 - d_i / dist);
        dxSum += grad_x;
        dySum += grad_y;
        error += (dist - d_i) ** 2;
      }

      x -= learningRate * dxSum;
      y -= learningRate * dySum;

      // Enforce bounds during optimization
      x = Math.max(0, Math.min(5, x));
      y = Math.max(0, Math.min(5, y));

      if (error < tolerance) break;
    }

    if (isNaN(x) || isNaN(y)) {
      console.warn(`Trilateration failed for ${mac}: NaN values`);
      return null;
    }

    return { x, y };
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
    this.externalSavedPositions = {};
    for (const [mac, pos] of Object.entries(saved)) {
      const normMac = mac.toLowerCase();
      if (pos.x >= 0 && pos.x <= 5 && pos.y >= 0 && pos.y <= 5) {
        this.externalSavedPositions[normMac] = { x: pos.x, y: pos.y };
        console.log(
          `Set saved position for ${normMac}: (x: ${pos.x.toFixed(
            2,
          )}, y: ${pos.y.toFixed(2)})`,
        );
      } else {
        console.warn(
          `Invalid saved position for ${normMac}: (x: ${pos.x}, y: ${pos.y})`,
        );
      }
    }
  }

  public getAllPositions(): { [mac: string]: Position } {
    return { ...this.currentPositions };
  }

  public getPosition(mac: string): Position | null {
    return this.currentPositions[mac.toLowerCase()] || null;
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
}
