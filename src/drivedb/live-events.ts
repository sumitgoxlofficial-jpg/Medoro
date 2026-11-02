/**
 * Window events that connect the live feed (src/components/shell/use-live.ts) with a Drive counter
 * (src/drivedb/device.ts). Only names here, so both sides can import them without pulling in each other.
 */
/** Another device uploaded changes to Drive. detail: { device } */
export const DRIVEDB_EVENT = "medoro:drivedb";
/** The live feed connected or dropped. detail: { live } */
export const LIVE_EVENT = "medoro:live";
/** This counter applied changes from other devices: screens reload their data. detail: { applied } */
export const DEVICE_CHANGED_EVENT = "medoro:device-changed";
