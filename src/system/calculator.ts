import mqtt from "mqtt";
import * as fs from "fs";

// MQTT Setup
const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
if (!brokerUrl) throw new Error("MQTT_BROKER_URL is not set");
const client = mqtt.connect(brokerUrl);

// Configuration
const SMOOTHING_FACTOR = 0.1; // 0.1-0.5 (lower = smoother)
const MIN_ANCHORS = 4; // Minimum anchors required for positioning
const TARGET_MAC = "C0:01:94:7C:3F:A7".toLowerCase(); // Filter for specific beacon
const POSITION_FILE = "saved_position.json";
const MOVEMENT_THRESHOLD = 1.9; // meters - distance threshold to consider movement significant

// Anchor positions (in meters)
const anchorPositions: { [id: number]: { x: number; y: number } } = {
  1: { x: 0, y: 0 },
  2: { x: 7, y: 0 },
  3: { x: 0, y: 10 },
  4: { x: 7, y: 10 },
};

// Data structures
interface AnchorRSSI {
  [anchorId: number]: number;
}
const beaconRSSI: { [mac: string]: AnchorRSSI } = {};
const smoothedPositions: { [mac: string]: { x: number; y: number } } = {};

// Load saved position
let savedPosition: { x: number; y: number } | null = null;
try {
  if (fs.existsSync(POSITION_FILE)) {
    const data = fs.readFileSync(POSITION_FILE, "utf8");
    savedPosition = JSON.parse(data);
    console.log(`Loaded saved position: ${JSON.stringify(savedPosition)}`);
  }
} catch (err) {
  console.error("Error loading saved position:", err);
}

// MQTT Connection
client.on("connect", () => {
  console.log("Connected to MQTT broker");
  client.subscribe("esp32_1/rssi");
  client.subscribe("esp32_2/rssi");
  client.subscribe("esp32_3/rssi");
  client.subscribe("esp32_4/rssi");
});

// Message Handler
client.on("message", (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const { mac, rssi, esp } = data;

    // Filter for target beacon
    if (mac !== TARGET_MAC) return;

    // Store raw RSSI
    if (!beaconRSSI[mac]) beaconRSSI[mac] = {};
    beaconRSSI[mac][esp] = rssi;

    // Estimate position only when enough anchors are available
    if (Object.keys(beaconRSSI[mac]).length >= MIN_ANCHORS) {
      const newPos = estimatePosition(beaconRSSI[mac]);

      if (newPos) {
        // Apply exponential smoothing to position
        if (!smoothedPositions[mac]) {
          smoothedPositions[mac] = newPos;
        } else {
          smoothedPositions[mac].x =
            SMOOTHING_FACTOR * newPos.x +
            (1 - SMOOTHING_FACTOR) * smoothedPositions[mac].x;
          smoothedPositions[mac].y =
            SMOOTHING_FACTOR * newPos.y +
            (1 - SMOOTHING_FACTOR) * smoothedPositions[mac].y;
        }

        const currentPos = smoothedPositions[mac];
        console.log(
          `Beacon ${mac} at (x: ${currentPos.x.toFixed(2)}, y: ${currentPos.y.toFixed(2)})`,
        );

        // Check distance from saved position
        if (savedPosition) {
          const distance = calculateDistance(currentPos, savedPosition);
          if (distance > MOVEMENT_THRESHOLD) {
            console.log(
              `⚠️ Device moved ${distance.toFixed(2)}m from saved position!`,
            );
          }
        }
      }
    }
  } catch (error) {
    console.error("MQTT message error:", error);
  }
});

// Calculate distance between two points
function calculateDistance(
  pos1: { x: number; y: number },
  pos2: { x: number; y: number },
): number {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Save position to file
function savePosition(position: { x: number; y: number }): void {
  try {
    fs.writeFileSync(POSITION_FILE, JSON.stringify(position));
    savedPosition = position;
    console.log(`Position saved: ${JSON.stringify(position)}`);
  } catch (err) {
    console.error("Error saving position:", err);
  }
}

// Optimized Position Estimation (Small-room variant)
function estimatePosition(
  rssiMap: AnchorRSSI,
): { x: number; y: number } | null {
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (const [anchorIdStr, rssi] of Object.entries(rssiMap)) {
    const anchorId = Number(anchorIdStr);
    const pos = anchorPositions[anchorId];
    if (!pos) continue;

    // Aggressive weighting for small rooms (weak signals matter less)
    const weight = Math.pow(10, rssi / 20); // Note: 20 instead of 10
    totalWeight += weight;
    weightedX += pos.x * weight;
    weightedY += pos.y * weight;
  }

  return totalWeight > 0
    ? { x: weightedX / totalWeight, y: weightedY / totalWeight }
    : null;
}

// Add command to save current position (for example via console input)
process.stdin.on("data", (data) => {
  const input = data.toString().trim();
  if (input === "save" && smoothedPositions[TARGET_MAC]) {
    savePosition(smoothedPositions[TARGET_MAC]);
  }
});

console.log("Type 'save' to save the current position");
