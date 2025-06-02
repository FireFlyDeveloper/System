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

export class PositioningSystem {
  private ws: WSContext | undefined;
  private readonly brokerUrl = process.env.brokerUrl || "mqtt://localhost";
  private readonly client = mqtt.connect(this.brokerUrl);
  private readonly smoothingFactor = 1;
  private readonly minAnchors = 3; // Minimum for 2D trilateration
  private readonly movementThreshold = 0.15;
  private readonly maxSignalAge = 2500; // Max age of signal in ms

  // Anchor positions in meters (update with your actual anchor positions)
  private readonly anchorPositions: { [id: number]: Position } = {
    1: { x: 0, y: 0 }, // Anchor 1 at origin
    2: { x: 5, y: 0 }, // Anchor 2 at 5m on x-axis
    3: { x: 0, y: 5 }, // Anchor 3 at 5m on y-axis
    4: { x: 5, y: 5 }, // Anchor 4 at 5m x, 5m y
  };

  // BLE signal propagation constants (adjust based on your environment)
  private readonly txPower = -59; // RSSI at 1 meter
  private readonly pathLossExponent = 2.0; // Free space is 2.0, higher for more obstructed

  private targetMacs: Set<string> = new Set();
  private beaconData: { [mac: string]: { [anchorId: number]: AnchorData } } =
    {};
  private smoothedPositions: { [mac: string]: Position } = {};
  private externalSavedPositions: { [mac: string]: Position } = {};
  private lastSeenTimestamps: { [mac: string]: number } = {};
  private readonly offlineTimeout = 30000;
  private readonly offlineCheckInterval = 30000;
  private violationCounts: { [mac: string]: number } = {};
  private readonly maxViolationsBeforeAlert = 5;
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

        // Initialize if not exists
        if (!this.beaconData[normalizedMac]) {
          this.beaconData[normalizedMac] = {};
        }

        // Store data with timestamp
        this.beaconData[normalizedMac][anchorId] = {
          rssi,
          timestamp: Date.now(),
        };

        this.lastSeenTimestamps[normalizedMac] = Date.now();

        // Process position if we have enough fresh data
        this.processPosition(normalizedMac);
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
    // First clean up old data
    this.cleanOldData(mac);

    // Check if we have enough fresh data
    const anchorCount = this.beaconData[mac]
      ? Object.keys(this.beaconData[mac]).length
      : 0;
    console.log(anchorCount);
    if (anchorCount < this.minAnchors) {
      console.log(`Not enough fresh data for ${mac} (${anchorCount} anchors)`);
      return;
    }

    const newPos = this.trilateratePosition(mac);
    if (!newPos) return;

    // Apply smoothing
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

  private cleanOldData(mac: string) {
    const now = Date.now();
    if (this.beaconData[mac]) {
      Object.keys(this.beaconData[mac]).forEach((anchorIdStr) => {
        const anchorId = parseInt(anchorIdStr);
        if (
          now - this.beaconData[mac][anchorId].timestamp >
          this.maxSignalAge
        ) {
          delete this.beaconData[mac][anchorId];
        }
      });
    }
  }

  private rssiToDistance(rssi: number): number {
    // Log-distance path loss model
    return Math.pow(10, (this.txPower - rssi) / (10 * this.pathLossExponent));
  }

  private trilateratePosition(mac: string): Position | null {
    const anchorData = this.beaconData[mac];
    if (!anchorData) return null;

    // Convert anchor data to array of {position, distance} objects
    const anchors = Object.entries(anchorData).map(([anchorIdStr, data]) => {
      const anchorId = parseInt(anchorIdStr);
      return {
        position: this.anchorPositions[anchorId],
        distance: this.rssiToDistance(data.rssi),
      };
    });

    // Need at least 3 anchors for 2D trilateration
    if (anchors.length < 3) return null;

    // Use the first anchor as reference
    const A = anchors[0];
    const B = anchors[1];
    const C = anchors[2];

    // Calculate differences between reference anchor and others
    const dA = A.distance;
    const dB = B.distance;
    const dC = C.distance;

    const xA = A.position.x;
    const yA = A.position.y;
    const xB = B.position.x;
    const yB = B.position.y;
    const xC = C.position.x;
    const yC = C.position.y;

    // Calculate vector from A to B
    const ABx = xB - xA;
    const ABy = yB - yA;

    // Calculate vector from A to C
    const ACx = xC - xA;
    const ACy = yC - yA;

    // Calculate the dot product of AB and AC
    const ABAC = ABx * ACx + ABy * ACy;

    // Calculate the length of AB squared
    const ABAB = ABx * ABx + ABy * ABy;

    // Calculate the length of AC squared
    const ACAC = ACx * ACx + ACy * ACy;

    // Calculate denominator
    const denom = ABAB * ACAC - ABAC * ABAC;

    if (Math.abs(denom) < 0.000001) {
      console.warn("Anchors are colinear, cannot trilaterate");
      return null;
    }

    // Calculate the distance from A to projection of C on AB
    let t = ACx * (xC - xA) + ACy * (yC - yA);
    t /= denom;

    // Calculate the projection of C on AB
    const projCx = xA + t * ABx;
    const projCy = yA + t * ABy;

    // Calculate the vector from projection to C
    const CprojCx = xC - projCx;
    const CprojCy = yC - projCy;

    // Calculate the length of this vector
    const lenCprojC = Math.sqrt(CprojCx * CprojCx + CprojCy * CprojCy);

    if (lenCprojC < 0.000001) {
      console.warn("Anchors are colinear, cannot trilaterate");
      return null;
    }

    // Normalize the vector
    const normCprojCx = CprojCx / lenCprojC;
    const normCprojCy = CprojCy / lenCprojC;

    // Calculate the position using trilateration
    const x =
      projCx +
      (normCprojCx *
        (dA * dA - dB * dB + xB * xB + yB * yB - xA * xA - yA * yA)) /
        (2 * lenCprojC);
    const y =
      projCy +
      (normCprojCy *
        (dA * dA - dB * dB + xB * xB + yB * yB - xA * xA - yA * yA)) /
        (2 * lenCprojC);

    // If we have a 4th anchor, we can refine the position
    if (anchors.length >= 4) {
      const D = anchors[3];
      const dD = D.distance;
      const xD = D.position.x;
      const yD = D.position.y;

      // Calculate distance from estimated position to D
      const estDistToD = Math.sqrt((x - xD) * (x - xD) + (y - yD) * (y - yD));

      // Adjust position based on 4th anchor
      const error = dD - estDistToD;
      const adjustX = ((x - xD) / estDistToD) * error * 0.5;
      const adjustY = ((y - yD) / estDistToD) * error * 0.5;

      return {
        x: x + adjustX,
        y: y + adjustY,
      };
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
