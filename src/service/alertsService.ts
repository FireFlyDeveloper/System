import { pool } from "../database/postgreSQL";

// Create the alerts table if it doesn't exist
export const createAlertsTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      type TEXT NOT NULL,  -- New column for alert type
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
  type: string, // New parameter for alert type
): Promise<boolean> => {
  try {
    await pool.query(
      "INSERT INTO alerts (device_id, message, type) VALUES ($1, $2, $3)", // Updated query
      [device_id, message, type],
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

// Get all alerts with pagination (20 items per page) and total count
export const getAllAlerts = async (page: number = 1) => {
  const itemsPerPage = 20;
  const offset = (page - 1) * itemsPerPage;

  try {
    // Get paginated results
    const alertsQuery = pool.query(
      "SELECT * FROM alerts ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [itemsPerPage, offset],
    );

    // Get total count
    const countQuery = pool.query("SELECT COUNT(*) FROM alerts");

    const [alertsResult, countResult] = await Promise.all([
      alertsQuery,
      countQuery,
    ]);

    return {
      alerts: alertsResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      itemsPerPage,
    };
  } catch (error) {
    console.error("Error fetching all alerts:", error);
    return {
      alerts: [],
      total: 0,
      page,
      itemsPerPage,
    };
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
