import { pool } from "../database/postgreSQL";

// Create the alerts table if it doesn't exist
export const createAlertsTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  try {
    await pool.query(query);
    console.log("Alerts table created successfully");
  } catch (error) {
    console.error("Error creating alerts table:", error);
  }
};

// Add a new alert
export const addAlert = async (
  device_id: number,
  message: string,
): Promise<boolean> => {
  try {
    await pool.query(
      "INSERT INTO alerts (device_id, message) VALUES ($1, $2)",
      [device_id, message],
    );
    return true;
  } catch (error) {
    console.error("Error adding alert:", error);
    return false;
  }
};

// Get all alerts for a specific device
export const getAlertsByDeviceId = async (device_id: number) => {
  try {
    const result = await pool.query(
      "SELECT * FROM alerts WHERE device_id = $1 ORDER BY created_at DESC",
      [device_id],
    );
    return result.rows;
  } catch (error) {
    console.error("Error fetching alerts by device ID:", error);
    return [];
  }
};

// Get all alerts
export const getAllAlerts = async () => {
  try {
    const result = await pool.query(
      "SELECT * FROM alerts ORDER BY created_at DESC",
    );
    return result.rows;
  } catch (error) {
    console.error("Error fetching all alerts:", error);
    return [];
  }
};

// Delete an alert
export const deleteAlert = async (alert_id: number): Promise<boolean> => {
  try {
    await pool.query("DELETE FROM alerts WHERE id = $1", [alert_id]);
    return true;
  } catch (error) {
    console.error("Error deleting alert:", error);
    return false;
  }
};
