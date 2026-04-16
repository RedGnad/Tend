import { describe, it, expect } from "vitest";
import {
  SERVICE_REGISTRY,
  getService,
  getAvailableServices,
} from "../state/service-registry.js";
import { TOTAL_BPS } from "@tend/shared";

describe("Service Registry", () => {
  it("has 3 services defined", () => {
    expect(SERVICE_REGISTRY).toHaveLength(3);
  });

  it("all services are available", () => {
    SERVICE_REGISTRY.forEach((s) => expect(s.status).toBe("available"));
  });

  it("getAvailableServices returns all services", () => {
    const services = getAvailableServices();
    expect(services).toHaveLength(3);
    const ids = services.map((s) => s.id).sort();
    expect(ids).toEqual(["allocation-advisor", "analytics", "buyback-bot"]);
  });

  it("getService returns correct service by id", () => {
    const bot = getService("buyback-bot");
    expect(bot).toBeDefined();
    expect(bot!.name).toBe("Buyback Bot");
    expect(bot!.defaultBps).toBe(1500);
  });

  it("getService returns undefined for unknown id", () => {
    expect(getService("nonexistent")).toBeUndefined();
  });

  it("all services have valid BPS ranges", () => {
    SERVICE_REGISTRY.forEach((s) => {
      expect(s.minBps).toBeGreaterThanOrEqual(0);
      expect(s.maxBps).toBeGreaterThanOrEqual(s.minBps);
      expect(s.defaultBps).toBeGreaterThanOrEqual(s.minBps);
      expect(s.defaultBps).toBeLessThanOrEqual(s.maxBps);
      expect(s.maxBps).toBeLessThanOrEqual(TOTAL_BPS);
    });
  });

  it("all services have unique ids", () => {
    const ids = SERVICE_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all services have required fields", () => {
    SERVICE_REGISTRY.forEach((s) => {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.status).toBe("available");
    });
  });
});
