/**
 * Static configuration for market hours and timezones.
 * Extracted to a dedicated constants file to prevent Temporal Dead Zone (TDZ) 
 * errors during complex dependency initialization.
 */

export const MARKET_HOURS = {
  US: { open: 9.5, close: 16.0, tz: "America/New_York" }, // 9:30 AM - 4:00 PM
  HK: { open: 9.5, close: 16.0, lunch: [12.0, 13.0], tz: "Asia/Hong_Kong" }, // 9:30 AM - 12:00 PM, 1:00 PM - 4:00 PM
  JP: { open: 9.0, close: 15.0, lunch: [11.5, 12.5], tz: "Asia/Tokyo" }, // 9:00 AM - 11:30 AM, 12:30 PM - 3:00 PM
  UK: { open: 8.0, close: 16.5, tz: "Europe/London" }, // 8:00 AM - 4:30 PM
  DE: { open: 9.0, close: 17.5, tz: "Europe/Berlin" }, // 9:00 AM - 5:30 PM
  FR: { open: 9.0, close: 17.5, tz: "Europe/Paris" },
  CN: { open: 9.5, close: 15.0, lunch: [11.5, 13.0], tz: "Asia/Shanghai" },
  AU: { open: 10.0, close: 16.0, tz: "Australia/Sydney" },
  CA: { open: 9.5, close: 16.0, tz: "America/Toronto" },
  IN: { open: 9.25, close: 15.5, tz: "Asia/Kolkata" },
};
