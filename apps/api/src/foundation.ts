import { randomUUID } from "node:crypto";
import { Controller, Get, HttpException, HttpStatus, Post } from "@nestjs/common";
import { getReadiness } from "./readiness";

function unavailable(message: string): never {
  throw new HttpException(
    { code: "ORDERING_NOT_CONFIGURED", message, correlation_id: randomUUID(), details: getReadiness() },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

@Controller("v1")
export class FoundationController {
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
