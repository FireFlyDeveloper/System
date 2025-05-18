import { pool } from "../database/postgreSQL";

// Create the devices table if it doesn't exist
export const createDevicesTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      mac VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      saved_position JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  try {
    await pool.query(query);
    console.log("Devices table created successfully");
  } catch (error) {
    console.error("Error creating devices table:", error);
  }
};

// Add a new device
export const addDevice = async (
  mac: string,
  name: string,
  saved_position?: object,
): Promise<boolean> => {
  try {
    await pool.query(
      "INSERT INTO devices (mac, name, saved_position) VALUES ($1, $2, $3)",
      [mac, name, saved_position],
    );
    return true;
  } catch (error) {
    console.error("Error adding device:", error);
    return false;
  }
};

// Update an existing device
export const updateDevice = async (
  id: number,
  mac: string,
  name: string,
  saved_position?: object,
): Promise<boolean> => {
  try {
    await pool.query(
      "UPDATE devices SET mac = $1, name = $2, saved_position = $3 WHERE id = $4",
      [mac, name, saved_position, id],
    );
    return true;
  } catch (error) {
    console.error("Error updating device:", error);
    return false;
  }
};

// Update only the saved_position of a device
export const updateDevicePosition = async (
  id: number,
  saved_position: object,
): Promise<boolean> => {
  try {
    await pool.query("UPDATE devices SET saved_position = $1 WHERE id = $2", [
      saved_position,
      id,
    ]);
    return true;
  } catch (error) {
    console.error("Error updating device position:", error);
    return false;
  }
};

// Delete a device by ID
export const deleteDevice = async (id: number): Promise<boolean> => {
  try {
    await pool.query("DELETE FROM devices WHERE id = $1", [id]);
    return true;
  } catch (error) {
    console.error("Error deleting device:", error);
    return false;
  }
};

// Get a single device by ID
export const getDeviceById = async (id: number) => {
  try {
    const result = await pool.query("SELECT * FROM devices WHERE id = $1", [
      id,
    ]);
    return result.rows[0] || null;
  } catch (error) {
    console.error("Error fetching device by ID:", error);
    return null;
  }
};

// Get all devices
export const getAllDevices = async () => {
  try {
    const result = await pool.query("SELECT * FROM devices ORDER BY id ASC");
    return result.rows;
  } catch (error) {
    console.error("Error fetching devices:", error);
    return [];
  }
};
