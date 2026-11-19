import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Inject, Post } from "@nestjs/common";
import { readStatus, runCheck } from "../../print-bridge/diagnostics.cjs";

export const PRINT_WEB_ORIGIN = "PRINT_WEB_ORIGIN";

@Controller("v1/print-diagnostics")
export class PrinterDiagnosticsController {
  constructor(@Inject(PRINT_WEB_ORIGIN) private readonly webOrigin: string) {}

  @Get()
  status() {
    return readStatus();
  }

  @Post("simulate")
  simulate(@Headers("origin") origin: string | undefined, @Body() body: unknown) {
    if (origin !== this.webOrigin) throw new ForbiddenException("Use the local staff console to run a specimen.");
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
      !("id" in body) || typeof body.id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.id)) {
      throw new BadRequestException("Supply a specimen request ID.");
    }
    return runCheck("simulator", body.id);
  }
}
