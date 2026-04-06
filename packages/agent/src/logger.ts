const PREFIX = "[tend-agent]";

export function log(...args: unknown[]) {
  console.log(PREFIX, new Date().toISOString(), ...args);
}

export function logError(...args: unknown[]) {
  console.error(PREFIX, new Date().toISOString(), "ERROR", ...args);
}
