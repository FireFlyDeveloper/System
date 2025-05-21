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
  private readonly brokerUrl = "mqtt://security.local";
  private readonly client = mqtt.connect(this.brokerUrl);
  private readonly smoothingFactor = 0.1;
  private readonly minAnchors = 4;
  private readonly movementThreshold = 1;

  private readonly anchorPositions: { [id: number]: Position } = {
    1: { x: 0, y: 0 },
    2: { x: 10, y: 0 },
    3: { x: 0, y: 12 },
    4: { x: 10, y: 12 },
  };

  private targetMacs: Set<string> = new Set();
  private beaconRSSI: { [mac: string]: AnchorRSSI } = {};
  private smoothedPositions: { [mac: string]: Position } = {};
  private externalSavedPositions: { [mac: string]: Position } = {};
  private lastSeenTimestamps: { [mac: string]: number } = {};
  private readonly offlineTimeout = 30000; // 30 seconds
  private readonly offlineCheckInterval = 5000; // 5 seconds
  private violationCounts: { [mac: string]: number } = {};
  private readonly maxViolationsBeforeAlert = 5;
  private readonly violationResetInterval = 10000; // 30 seconds
  private deviceIdMap: { [mac: string]: number } = {}; // Map MAC addresses to device IDs

  constructor() {
    this.setupMQTT();
    this.startOfflineChecker();
    this.startViolationResetTimer();
  }

  public setDeviceIdMap(devices: { id: number; mac: string }[]) {
    this.deviceIdMap = devices.reduce(
      (acc, device) => {
        acc[device.mac.toLowerCase()] = device.id;
        return acc;
      },
      {} as { [mac: string]: number },
    );
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

        if (!this.targetMacs.has(normalizedMac)) return;

        if (!this.beaconRSSI[normalizedMac])
          this.beaconRSSI[normalizedMac] = {};
        this.beaconRSSI[normalizedMac][esp] = rssi;

        this.lastSeenTimestamps[normalizedMac] = Date.now();

        if (
          Object.keys(this.beaconRSSI[normalizedMac]).length >= this.minAnchors
        ) {
          this.processPosition(normalizedMac);
        }
      } catch (err) {
        console.error("MQTT message error:", err);
      }
    });
  }

  private startViolationResetTimer() {
    setInterval(() => {
      for (const mac in this.violationCounts) {
        if (this.violationCounts[mac] > 0) {
          this.violationCounts[mac] = 0;
          console.log(`Reset violation count for ${mac}`);
        }
      }
    }, this.violationResetInterval);
  }

  private async triggerAlert(mac: string, message: string) {
    const deviceId = this.deviceIdMap[mac];
    if (deviceId) {
      await addAlert(deviceId, message);
    }

    if (this.ws) {
      this.ws.send(
        JSON.stringify({
          type: "alert",
          mac,
          message,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    console.warn(`⚠️ ALERT: ${message}`);
  }

  private startOfflineChecker() {
    setInterval(() => {
      const now = Date.now();
      Array.from(this.targetMacs).forEach((mac) => {
        const lastSeen = this.lastSeenTimestamps[mac];
        if (!lastSeen || now - lastSeen > this.offlineTimeout) {
          this.violationCounts[mac] = (this.violationCounts[mac] || 0) + 1;

          if (this.violationCounts[mac] >= this.maxViolationsBeforeAlert) {
            this.triggerAlert(
              mac,
              `Device ${mac} is offline for extended period`,
            );
            updateDeviceStatus(mac, "offline");
            this.violationCounts[mac] = 0;
          }
        }
      });
    }, this.offlineCheckInterval);
  }

  private processPosition(mac: string) {
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

    if (savedPos) {
      const distance = this.calculateDistance(currentPos, savedPos);
      if (distance > this.movementThreshold) {
        this.violationCounts[mac] = (this.violationCounts[mac] || 0) + 1;

        if (this.violationCounts[mac] >= this.maxViolationsBeforeAlert) {
          this.triggerAlert(
            mac,
            `Device ${mac} moved ${distance.toFixed(2)}m from saved position`,
          );
          updateDeviceStatus(mac, "out_of_position");
          this.violationCounts[mac] = 0;
        }
      } else {
        this.violationCounts[mac] = 0;
        updateDeviceStatus(mac, "online");
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

      const weight = Math.pow(10, rssi / 20);
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
    this.targetMacs = new Set(macs.map((mac) => mac.toLowerCase()));
  }

  public updateTargetMacs(macs: string[]) {
    macs
      .map((mac) => mac.toLowerCase())
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
}
