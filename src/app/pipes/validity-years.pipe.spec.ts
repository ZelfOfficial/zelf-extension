import { validityYears } from "./validity-years.pipe";

describe("validityYears", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");

    it("free 100-year lease shows 100", () => {
        expect(validityYears({ duration: 100, registeredAt: "2026-09-29 20:24:12", expiresAt: "2126-09-29 20:24:12" }, now)).toBe(100);
    });

    it("derives years from registeredAt -> expiresAt when duration is missing", () => {
        expect(validityYears({ registeredAt: "2026-01-01 00:00:00", expiresAt: "2029-01-01 00:00:00" }, now)).toBe(3);
    });

    it("1 year", () => {
        expect(validityYears({ duration: "1", registeredAt: "2026-10-16 00:00:00", expiresAt: "2027-10-17 00:00:00" }, now)).toBe(1);
    });

    it("null when under a year left or expired or no expiry", () => {
        expect(validityYears({ duration: "2", registeredAt: "2026-04-22 03:03:26", expiresAt: "2027-08-31 13:15:09" }, now)).toBeNull();
        expect(validityYears({ expiresAt: "2020-01-01 00:00:00" }, now)).toBeNull();
        expect(validityYears({}, now)).toBeNull();
    });
});
