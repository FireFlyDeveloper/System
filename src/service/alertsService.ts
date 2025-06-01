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
      "INSERT INTO alerts (device_id, message, type) VALUES ($1, $2, $3)",
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

// Get all alerts with pagination (20 items per page) and optional type filter
export const getAllAlerts = async (
  page: number = 1,
  type?: string, // 'warning' | 'critical' or undefined
) => {
  const itemsPerPage = 20;
  const offset = (page - 1) * itemsPerPage;

  // Only apply filter if type is 'warning' or 'critical'
  const validTypes = ["offline_alert", "alert", "position_recovered"];
  const useFilter = type && validTypes.includes(type);

  // Build query parts dynamically
  const whereClause = useFilter ? `WHERE type = $1` : ``;
  const orderLimitOffset = `ORDER BY created_at DESC LIMIT $${useFilter ? 2 : 1} OFFSET $${useFilter ? 3 : 2}`;

  // Build params array
  const params = [];
  if (useFilter) {
    params.push(type);
  }
  params.push(itemsPerPage, offset);

  try {
    // Fetch paginated alerts
    const alertsQuery = pool.query(
      `SELECT * FROM alerts ${whereClause} ${orderLimitOffset}`,
      params,
    );

    // Fetch total count with same filter
    const countParams = useFilter ? [type] : [];
    const countWhere = useFilter ? `WHERE type = $1` : ``;
    const countQuery = pool.query(
      `SELECT COUNT(*) FROM alerts ${countWhere}`,
      countParams,
    );

    const [alertsResult, countResult] = await Promise.all([
      alertsQuery,
      countQuery,
    ]);

    return {
      alerts: alertsResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      itemsPerPage,
      filterType: useFilter ? type : "all",
    };
  } catch (error) {
    console.error("Error fetching all alerts:", error);
    return {
      alerts: [],
      total: 0,
      page,
      itemsPerPage,
      filterType: useFilter ? type : "all",
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
