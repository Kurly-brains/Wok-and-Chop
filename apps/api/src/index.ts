import "reflect-metadata";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { Controller, Get, Module, Query } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { defaultReservationSettings } from "../../../packages/domain/src/reservation-settings";
import { FoundationController } from "./foundation";

@Controller("v1")
class HostedPreviewController {
  @Get("menu")
  menu(@Query("after") after: unknown) {
    return { version: 1, overrides: after === "1" ? null : {} };
  }

  @Get("auth/me")
  account() {
    return { user: null };
  }

  @Get("auth/deliveries/config")
  delivery() {
    return { enabled: false, postalPrefixes: [] };
  }

  @Get("auth/pickups/config")
  pickup() {
    return { enabled: false };
  }

  @Get("guest-services/config")
  guestServices() {
    return { contactEnabled: false, reservationsEnabled: false, emailEnabled: false, reservationSettings: defaultReservationSettings };
  }

  @Get("marketing/config")
  marketing() {
    return { emailEnabled: false };
  }
}

@Module({ controllers: [FoundationController, HostedPreviewController] })
class HostedPreviewModule {}

async function createHostedHandler(): Promise<RequestListener> {
  const app = await NestFactory.create<NestExpressApplication>(HostedPreviewModule, {
    logger: false,
    bodyParser: false,
    abortOnError: false,
  });
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use((_request: IncomingMessage, response: ServerResponse, next: () => void) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  await app.init();
  return app.getHttpAdapter().getInstance() as RequestListener;
}

let hostedHandler: Promise<RequestListener> | undefined;

export default async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const handle = await (hostedHandler ??= createHostedHandler());
  handle(request, response);
}
