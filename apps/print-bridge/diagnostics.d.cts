export interface TestResult {
  id: string;
  mode: "hardware" | "simulator";
  outcome: "simulated" | "socket-sent" | "not-sent" | "uncertain";
  created: string;
  digest: string;
  ticket: string;
}
export interface PrinterStatus {
  setup: "configured" | "invalid" | "unconfigured";
  lastSimulator: TestResult | null;
  lastHardware: TestResult | null;
  paperObservedAt: string | null;
}
export function readStatus(): PrinterStatus;
export function runCheck(mode: TestResult["mode"], id: string): Promise<TestResult>;
export function writeToSocket(address: { host: string; port: number }, bytes: Uint8Array): Promise<TestResult["outcome"]>;
export function recordPaper(id: string): { id: string; evidence: string; observedAt: string };
