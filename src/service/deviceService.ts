import { pool } from "../database/postgreSQL";

// Create the devices table if it doesn't exist
export const createDevicesTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      mac VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      saved_position JSONB,
      status VARCHAR(50) DEFAULT 'offline',
      enable BOOLEAN DEFAULT true,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
  status: string = "offline",
  enable: boolean = true,
): Promise<boolean> => {
  try {
    await pool.query(
      "INSERT INTO devices (mac, name, saved_position, status, enable) VALUES ($1, $2, $3, $4, $5)",
      [mac, name, saved_position, status, enable],
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
  status?: string,
  enable?: boolean,
): Promise<boolean> => {
  try {
    await pool.query(
      "UPDATE devices SET mac = $1, name = $2, saved_position = $3, status = $4, enable = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6",
      [mac, name, saved_position, status ?? "offline", enable ?? true, id],
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
    await pool.query(
      "UPDATE devices SET saved_position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [saved_position, id],
    );
    return true;
  } catch (error) {
    console.error("Error updating device position:", error);
    return false;
  }
};

// Update only the status of a device
export const updateDeviceStatus = async (
  mac: string,
  status: string,
): Promise<boolean> => {
  try {
    await pool.query(
      "UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE mac = $2",
      [status, mac],
    );
    return true;
  } catch (error) {
    console.error("Error updating device status:", error);
    return false;
  }
};

// Update a device by MAC address
export const updateDeviceByMac = async (
  mac: string,
  name?: string,
  saved_position?: object,
  status?: string,
  enable?: boolean,
): Promise<boolean> => {
  const fields: string[] = [];
  const values: any[] = [];
  let index = 1;

  if (name !== undefined) {
    fields.push(`name = $${index++}`);
    values.push(name);
  }

  if (saved_position !== undefined) {
    fields.push(`saved_position = $${index++}`);
    values.push(saved_position);
  }

  if (status !== undefined) {
    fields.push(`status = $${index++}`);
    values.push(status);
  }

  if (enable !== undefined) {
    fields.push(`enable = $${index++}`);
    values.push(enable);
  }

  if (fields.length === 0) return false;

  // Always update updated_at
  fields.push(`updated_at = CURRENT_TIMESTAMP`);

  values.push(mac);

  const query = `UPDATE devices SET ${fields.join(", ")} WHERE mac = $${index}`;

  try {
    await pool.query(query, values);
    return true;
  } catch (error) {
    console.error("Error updating device by MAC:", error);
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
    const result = await pool.query("SELECT * FROM devices ORDER BY name ASC");
    return result.rows;
  } catch (error) {
    console.error("Error fetching devices:", error);
    return [];
  }
};

// Add multiple devices
export const addDevices = async (
  devices: {
    mac: string;
    name: string;
    saved_position?: object;
    status?: string;
    enable?: boolean;
  }[],
): Promise<any> => {
  if (devices.length === 0) return false;

  const values: any[] = [];
  const placeholders: string[] = [];

  devices.forEach(({ mac, name, saved_position, status, enable }, i) => {
    const idx = i * 5;
    placeholders.push(
      `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`,
    );
    values.push(
      mac,
      name,
      saved_position ?? null,
      status ?? "offline",
      enable ?? true,
    );
  });

  const query = `
    INSERT INTO devices (mac, name, saved_position, status, enable)
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (mac) DO NOTHING
  `;

  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    console.error("Error adding multiple devices:", error);
    return [];
  }
};

// Update multiple devices
export const updateDevices = async (
  devices: {
    mac: string;
    name?: string;
    saved_position?: object;
    status?: string;
    enable?: boolean;
  }[],
): Promise<boolean> => {
  if (devices.length === 0) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { mac, name, saved_position, status, enable } of devices) {
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (name !== undefined) {
        fields.push(`name = $${idx++}`);
        values.push(name);
      }
      if (saved_position !== undefined) {
        fields.push(`saved_position = $${idx++}`);
        values.push(saved_position);
      }
      if (status !== undefined) {
        fields.push(`status = $${idx++}`);
        values.push(status);
      }
      if (enable !== undefined) {
        fields.push(`enable = $${idx++}`);
        values.push(enable);
      }

      if (fields.length === 0) continue;

      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(mac);

      const query = `UPDATE devices SET ${fields.join(
        ", ",
      )} WHERE mac = $${idx}`;
      await client.query(query, values);
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating multiple devices:", error);
    return false;
  } finally {
    client.release();
  }
};

// Delete multiple devices by IDs
export const deleteDevices = async (ids: number[]): Promise<boolean> => {
  if (ids.length === 0) return false;
  try {
    await pool.query("DELETE FROM devices WHERE id = ANY($1)", [ids]);
    return true;
  } catch (error) {
    console.error("Error deleting multiple devices:", error);
    return false;
  }
};
