import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { FoundationController } from "./foundation";
import { AuthController, AuthService } from "./auth";
import { CustomerDirectoryController } from "./customer-directory";
import { DeliveryController, ManagerDeliveryController, ManagerPickupController, PickupController } from "./deliveries";
import { DeliveryReportsController } from "./delivery-reports";
import { StaffOverviewController } from "./staff-overview";
import { PrinterDiagnosticsController, PRINT_WEB_ORIGIN } from "./printer-diagnostics";
import { PublishedMenuController } from "./published-menu";
import { TrainingBoard, TrainingController } from "./training-board";
import { EmailOutboxWorker, NOTIFICATION_MAILER, smtpMailer, type NotificationMailer } from "./notifications";
import { GuestServicesController, ManagerGuestServicesController } from "./reservations";
import { AdminMarketingController, MarketingController, MarketingService } from "./marketing";
import { PasswordResetController, PasswordResetService } from "./password-reset";
import { WindowsPrinterController, WINDOWS_PRINTER_ADAPTER } from "./windows-printer";
import { windowsPrinterAdapter, type WindowsPrinterAdapter } from "../../print-bridge/windows-printer";

@Module({})
class AppModule {}

export async function createApplication(options: {
  authDatabaseUrl?: string;
  webOrigin?: string;
  trainingDatabasePath?: string;
  mailer?: NotificationMailer;
  dispatchEmails?: boolean;
  windowsPrinterAdapter?: WindowsPrinterAdapter;
} = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The local preview API cannot run in production.");
  }
  const webOrigin = options.webOrigin ?? "http://127.0.0.1:3000";
  const trainingDatabasePath = options.trainingDatabasePath;
  const app = await NestFactory.create<NestExpressApplication>({
    module: AppModule,
    controllers: [
      FoundationController, AuthController, PasswordResetController, CustomerDirectoryController,
      PickupController, DeliveryController, ManagerDeliveryController, ManagerPickupController, DeliveryReportsController, StaffOverviewController,
      GuestServicesController, ManagerGuestServicesController, PrinterDiagnosticsController,
      PublishedMenuController, WindowsPrinterController, MarketingController, AdminMarketingController,
      ...(trainingDatabasePath ? [TrainingController] : []),
    ],
    providers: [
      ...(trainingDatabasePath ? [{ provide: TrainingBoard, useFactory: () => new TrainingBoard(webOrigin, trainingDatabasePath) }] : []),
      { provide: AuthService, useFactory: () => new AuthService(options.authDatabaseUrl, webOrigin) },
      PasswordResetService,
      MarketingService,
      { provide: NOTIFICATION_MAILER, useValue: options.mailer ?? smtpMailer },
      { provide: WINDOWS_PRINTER_ADAPTER, useValue: options.windowsPrinterAdapter ?? windowsPrinterAdapter },
      {
        provide: EmailOutboxWorker,
        inject: [AuthService, NOTIFICATION_MAILER],
        useFactory: (auth: AuthService, mailer: NotificationMailer) =>
          new EmailOutboxWorker(auth, mailer, Boolean(options.dispatchEmails && options.authDatabaseUrl)),
      },
      { provide: PRINT_WEB_ORIGIN, useValue: webOrigin },
    ],
  }, { logger: false, rawBody: true });
  app.use((request: { headers: Record<string, string | string[] | undefined> }, response: {
    setHeader(name: string, value: string): unknown;
    status(code: number): { json(value: unknown): unknown };
  }, next: () => void) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    // Bind-to-loopback alone does not reject DNS-rebinding Host names.
    const host = request.headers.host;
    if (typeof host !== "string" || !/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(host)) {
      response.status(403).json({ code: "HOST_REJECTED", message: "This API is available only through its loopback preview address." });
      return;
    }
    next();
  });
  // The menu editor accepts base64 photos. Keep the standard JSON limit on other routes.
  app.useBodyParser("json", {
    limit: "650kb",
    type: (request: IncomingMessage) =>
      request.method === "POST" &&
      /^\/v1\/auth\/admin\/menu\/items(?:\/[^/?]+)?\/?(?:\?|$)/.test(request.url ?? "") &&
      /^application\/json\s*(?:;|$)/i.test(request.headers["content-type"] ?? ""),
  });
  app.useBodyParser("json");
  app.useBodyParser("urlencoded", {
    limit: "2kb",
    extended: false,
    type: (request: IncomingMessage) =>
      request.method === "POST" &&
      /^\/v1\/marketing\/unsubscribe\/?(?:\?|$)/.test(request.url ?? "") &&
      /^application\/x-www-form-urlencoded\s*(?:;|$)/i.test(request.headers["content-type"] ?? ""),
  });
  app.enableCors({ origin: webOrigin, credentials: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] });
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableShutdownHooks();
  return app;
}
