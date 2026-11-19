import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Controller, Get, HttpException, HttpStatus, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { getReadiness } from "./readiness";
import { AuthController, AuthService } from "./auth";
import { CustomerDirectoryController } from "./customer-directory";
import { DeliveryController, ManagerDeliveryController } from "./deliveries";
import { DeliveryReportsController } from "./delivery-reports";
import { PrinterDiagnosticsController, PRINT_WEB_ORIGIN } from "./printer-diagnostics";
import { PublishedMenuController } from "./published-menu";
import { TrainingBoard, TrainingController } from "./training-board";

function unavailable(message: string): never {
  throw new HttpException(
    { code: "ORDERING_NOT_CONFIGURED", message, correlation_id: randomUUID(), details: getReadiness() },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

@Controller("v1")
class FoundationController {
  @Get("health")
  health() {
    // Liveness alone never asserts that a database, payment provider or printer works.
    return { status: "alive", service: "wok-and-chop-api", acceptingOrders: false };
  }

  @Get("readiness")
  readiness(): never {
    throw new HttpException(getReadiness(), HttpStatus.SERVICE_UNAVAILABLE);
  }

  @Get("availability")
  availability() {
    return {
      status: "not_open_for_online_orders",
      acceptingOrders: false,
      fulfillmentModes: ["pickup"],
      restaurantTimezone: "America/Toronto",
      message: "Online ordering is not open yet. This website is a design preview.",
    };
  }

  @Post("quotes")
  quote(): never {
    return unavailable("Live quotes are unavailable until approved restaurant configuration is connected.");
  }

  @Post("checkout-sessions")
  checkout(): never {
    return unavailable("Online payment is not available. No order or payment has been created.");
  }

  @Post("webhooks/stripe")
  webhook(): never {
    // Never return success to a provider until signature verification and durable inbox exist.
    return unavailable("Payment event processing is not configured. No event has been accepted.");
  }
}

@Module({})
class AppModule {}

export async function createApplication(options: { authDatabaseUrl?: string; webOrigin?: string; trainingDatabasePath?: string } = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The local preview API cannot run in production.");
  }
  const webOrigin = options.webOrigin ?? "http://127.0.0.1:3000";
  const app = await NestFactory.create<NestExpressApplication>({
    module: AppModule,
    controllers: [FoundationController, AuthController, CustomerDirectoryController, DeliveryController, ManagerDeliveryController, DeliveryReportsController, PrinterDiagnosticsController, PublishedMenuController, TrainingController],
    providers: [
      { provide: TrainingBoard, useFactory: () => new TrainingBoard(webOrigin, options.trainingDatabasePath ?? process.env.TRAINING_DATABASE_PATH) },
      { provide: AuthService, useFactory: () => new AuthService(options.authDatabaseUrl, webOrigin) },
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
      /^\/v1\/auth\/admin\/menu\/items\/[^/?]+\/?(?:\?|$)/.test(request.url ?? "") &&
      /^application\/json\s*(?:;|$)/i.test(request.headers["content-type"] ?? ""),
  });
  app.useBodyParser("json");
  app.enableCors({ origin: webOrigin, credentials: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] });
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableShutdownHooks();
  return app;
}
