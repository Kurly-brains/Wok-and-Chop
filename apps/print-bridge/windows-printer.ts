import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type WindowsQueueStatus = {
  mode: "WINDOWS_QUEUE";
  configured: boolean;
  queueName: string | null;
  available: boolean;
  ready: boolean;
  physicalOutputVerified: false;
  detail: string;
};
export type WindowsPrintOutcome = {
  status: "SPOOLED" | "FAILED" | "UNKNOWN";
  detail: string;
};
export type WindowsPrinterAdapter = {
  status(): Promise<WindowsQueueStatus>;
  send(job: {
    id: string;
    queueName: string;
    text: string;
  }): Promise<WindowsPrintOutcome>;
};
type RunnerRequest = {
  operation: "status" | "print";
  queueName: string;
  jobId?: string;
  text?: string;
};
export type WindowsRunner = (
  request: RunnerRequest,
) => Promise<Record<string, unknown>>;

/** Fixed executable/script, JSON stdin, no interpolated shell command or printer default. */
export const runWindowsPrinter: WindowsRunner = (request) =>
  new Promise((resolveResult, reject) => {
    const script = [
      resolve(__dirname, "windows-printer.ps1"),
      resolve(process.cwd(), "apps/print-bridge/windows-printer.ps1"),
      resolve(process.cwd(), "../../apps/print-bridge/windows-printer.ps1"),
    ].find(existsSync);
    if (!script) {
      reject(new Error("Windows printer helper is missing."));
      return;
    }
    const executable = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    const child = spawn(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "RemoteSigned",
        "-File",
        script,
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );
    let output = "";
    let failed = false;
    const timer = setTimeout(
      () => {
        failed = true;
        child.kill();
        reject(new Error("Windows print helper timed out."));
      },
      request.operation === "status" ? 10_000 : 25_000,
    );
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString("utf8");
      if (output.length > 32_000) {
        failed = true;
        child.kill();
        reject(new Error("Invalid Windows helper output."));
      }
    });
    child.stderr.resume(); // Never log ticket text or OS exception details.
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      failed = true;
      reject(new Error("Windows printer helper could not start."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed) return;
      try {
        if (code !== 0) throw new Error("Windows printer helper failed.");
        const result = JSON.parse(output.replace(/^\uFEFF/, "").trim());
        if (!result || typeof result !== "object" || Array.isArray(result))
          throw new Error("Invalid Windows helper response.");
        resolveResult(result);
      } catch {
        reject(
          new Error("Windows printer helper returned no trustworthy result."),
        );
      }
    });
    child.stdin.end(JSON.stringify(request), "utf8");
  });

export function createWindowsPrinterAdapter(
  options: {
    queueName?: () => string | undefined;
    platform?: string;
    runner?: WindowsRunner;
  } = {},
): WindowsPrinterAdapter {
  const configuredQueue =
    options.queueName ?? (() => process.env.WOK_WINDOWS_PRINTER);
  const runner = options.runner ?? runWindowsPrinter;
  const queue = () => {
    const value = configuredQueue()?.trim();
    return value && value.length <= 220 && !/[\u0000-\u001f\u007f]/.test(value)
      ? value
      : null;
  };
  return {
    async status() {
      const queueName = queue();
      const base: WindowsQueueStatus = {
        mode: "WINDOWS_QUEUE",
        configured: Boolean(queueName),
        queueName,
        available: false,
        ready: false,
        physicalOutputVerified: false,
        detail:
          "Set WOK_WINDOWS_PRINTER to the exact installed Windows printer queue name, then restart the local API.",
      };
      if (!queueName) return base;
      if ((options.platform ?? process.platform) !== "win32")
        return {
          ...base,
          detail:
            "This printer connection requires the local API on the Windows computer attached to the printer.",
        };
      try {
        const result = await runner({ operation: "status", queueName });
        return {
          ...base,
          available: result.available === true,
          ready: result.available === true,
          detail:
            result.available === true
              ? "Windows reports this queue available. Send one test and inspect the paper before using kitchen tickets."
              : "Windows cannot use the selected queue. Check its exact name, driver, cable, paper and offline/paused state.",
        };
      } catch {
        return {
          ...base,
          detail:
            "The Windows queue could not be checked. Check the local printer driver and Windows Print Spooler.",
        };
      }
    },
    async send(job) {
      if (
        !queue() ||
        queue() !== job.queueName ||
        (options.platform ?? process.platform) !== "win32"
      )
        return {
          status: "FAILED",
          detail:
            "The configured Windows queue changed or is unavailable. Nothing was submitted.",
        };
      try {
        const result = await runner({
          operation: "print",
          queueName: job.queueName,
          jobId: job.id,
          text: job.text,
        });
        if (result.status === "SPOOLED")
          return {
            status: "SPOOLED",
            detail:
              "Windows accepted the ticket. Check the printer for paper output; this is not physical confirmation.",
          };
        if (result.status === "FAILED")
          return {
            status: "FAILED",
            detail:
              "Windows rejected the ticket before printing started. Check the configured queue and driver.",
          };
      } catch {
        /* A timeout or missing response may follow physical output. */
      }
      return {
        status: "UNKNOWN",
        detail:
          "The print outcome is uncertain. Check the queue and paper; this job will not be resent automatically.",
      };
    },
  };
}
export const windowsPrinterAdapter = createWindowsPrinterAdapter();
