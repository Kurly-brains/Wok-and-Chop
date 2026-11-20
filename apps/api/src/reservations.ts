import { createHash } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  defaultReservationSettings,
  type ReservationSettings,
} from "../../../packages/domain/src/reservation-settings";
import { AuthService } from "./auth";
import {
  emailConfigured,
  enqueueEmail,
  staffEmail,
  validEmailAddress,
} from "./notifications";

type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];
type Status = "REQUESTED" | "CONFIRMED" | "DECLINED" | "CANCELLED";
type ReservationRow = {
  id: string;
  reservation_number: string;
  request_fingerprint: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  date: string;
  time: string;
  starts_at: Date;
  party_size: number;
  status: Status;
  version: number;
  last_message: string;
  notification_mode: "PREVIEW" | "QUEUED";
  created_at: Date;
  updated_at: Date;
};
type ContactRow = {
  id: string;
  message_number: string;
  request_fingerprint: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  notification_mode: "PREVIEW" | "QUEUED";
  created_at: Date;
};
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const TIME_ZONE = "America/Toronto";
const DAY = 86_400_000;
const RESERVATION_TIME = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;
type SettingsRow = Pick<
  ReservationSettings,
  "paused" | "notice" | "firstTime" | "lastTime"
> & { version: number };
type VersionedSettings = ReservationSettings & { version: number };
const settingsColumns = `version, paused, notice, to_char(first_time,'HH24:MI') AS "firstTime", to_char(last_time,'HH24:MI') AS "lastTime"`;
const reservationColumns = `r.*, to_char(r.reservation_date,'YYYY-MM-DD') AS date, to_char(r.reservation_time,'HH24:MI') AS time`;
const localFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}
function object(body: unknown, allowed: string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail(400, "INVALID_INPUT", "Send the form fields as an object.");
  const data = body as Record<string, unknown>;
  if (Object.keys(data).some((key) => !allowed.includes(key)))
    fail(400, "INVALID_INPUT", "Unexpected form fields.");
  return data;
}
function text(
  value: unknown,
  field: string,
  max: number,
  min = 0,
  multiline = false,
) {
  if (value === undefined && min === 0) return "";
  if (typeof value !== "string") fail(400, "INVALID_INPUT", `Enter ${field}.`);
  const normalized = value.trim().replace(/\r\n?/g, "\n");
  const controls = multiline
    ? /[\u0000-\u0008\u000b-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (
    normalized.length < min ||
    normalized.length > max ||
    controls.test(normalized)
  )
    fail(
      400,
      "INVALID_INPUT",
      `${field} must have ${min} to ${max} characters without control characters.`,
    );
  return normalized;
}
function guest(data: Record<string, unknown>, phoneRequired: boolean) {
  const name = text(data.name, "Your name", 80, 1);
  const email = text(data.email, "Email address", 254, 3).toLowerCase();
  if (!validEmailAddress(email))
    fail(400, "INVALID_EMAIL", "Enter a single valid email address.");
  const phone = text(data.phone, "Phone number", 25, phoneRequired ? 7 : 0);
  if (
    phone &&
    (!/^[+()\d .-]+$/.test(phone) ||
      !/^\d{7,15}$/.test(phone.replace(/\D/g, "")))
  )
    fail(400, "INVALID_PHONE", "Enter a phone number with 7 to 15 digits.");
  if (typeof data.requestId !== "string" || !UUID.test(data.requestId))
    fail(400, "INVALID_REQUEST_ID", "A valid form request ID is required.");
  return { name, email, phone, requestId: data.requestId.toLowerCase() };
}
function party(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 20)
    fail(
      400,
      "INVALID_PARTY_SIZE",
      "Request a table for 1 to 20 guests. Contact the restaurant for larger groups.",
    );
  return value as number;
}
function wallClock(instant: number) {
  const parts = Object.fromEntries(
    localFormat.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
/** Resolve a Toronto wall time without silently shifting DST gaps or choosing an ambiguous hour. */
export function torontoInstant(date: unknown, time: unknown): Date {
  if (
    typeof date !== "string" ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
    typeof time !== "string" ||
    !RESERVATION_TIME.test(time)
  )
    fail(
      400,
      "INVALID_DATE_TIME",
      "Choose a valid date and a time in 15-minute increments.",
    );
  const local = `${date}T${time}:00`;
  const nominal = Date.parse(local + "Z");
  if (
    !Number.isFinite(nominal) ||
    new Date(nominal).toISOString().slice(0, 19) !== local
  )
    fail(400, "INVALID_DATE_TIME", "Choose a valid calendar date.");
  const offsets = new Set(
    [-DAY, 0, DAY].map(
      (shift) =>
        Date.parse(wallClock(nominal + shift) + "Z") - (nominal + shift),
    ),
  );
  const matches = [...offsets]
    .map((offset) => nominal - offset)
    .filter((instant) => wallClock(instant) === local);
  if (matches.length !== 1)
    fail(
      400,
      "INVALID_DATE_TIME",
      "That Toronto time is skipped or repeated by a daylight-saving change. Choose another time.",
    );
  return new Date(matches[0]);
}
function future(instant: Date) {
  const distance = instant.getTime() - Date.now();
  if (distance < 60 * 60_000 || distance > 180 * DAY)
    fail(
      400,
      "RESERVATION_WINDOW",
      "Request a time at least one hour ahead and within the next 180 days (Toronto time).",
    );
}
function notificationIntent(
  mode: "PREVIEW" | "QUEUED" = emailConfigured() ? "QUEUED" : "PREVIEW",
) {
  return { emailQueued: mode === "QUEUED", notificationMode: mode };
}
function publicReservation(row: ReservationRow) {
  return {
    number: `R-${row.reservation_number}`,
    status: row.status,
    version: row.version,
    date: row.date,
    time: row.time,
    partySize: row.party_size,
    timeZone: TIME_ZONE,
  };
}
function staffReservation(row: ReservationRow) {
  return {
    ...publicReservation(row),
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    lastMessage: row.last_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function availabilityUpdate(body: unknown) {
  const data = object(body, [
    "expectedVersion",
    "paused",
    "notice",
    "firstTime",
    "lastTime",
    "closures",
  ]);
  const { expectedVersion, paused, firstTime, lastTime, closures } = data;
  if (
    typeof expectedVersion !== "number" ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion >= 2_147_483_647
  ) {
    fail(
      400,
      "INVALID_VERSION",
      "Reload the booking settings before saving them.",
    );
  }
  if (typeof paused !== "boolean" || typeof data.notice !== "string") {
    fail(
      400,
      "INVALID_INPUT",
      "Choose whether bookings are paused and provide a notice or leave it blank.",
    );
  }
  if (
    typeof firstTime !== "string" ||
    typeof lastTime !== "string" ||
    !RESERVATION_TIME.test(firstTime) ||
    !RESERVATION_TIME.test(lastTime) ||
    firstTime > lastTime
  ) {
    fail(
      400,
      "INVALID_RESERVATION_HOURS",
      "Choose first and last seating times on the same day in 15-minute increments.",
    );
  }
  if (!Array.isArray(closures) || closures.length > 180) {
    fail(400, "INVALID_CLOSURES", "Add at most 180 closed dates.");
  }
  const dates = new Map<string, string>();
  for (const closure of closures) {
    const { date, notice } = object(closure, ["date", "notice"]);
    torontoInstant(date, "12:00");
    const day = date as string;
    if (dates.has(day))
      fail(400, "DUPLICATE_CLOSURE", "List each closed date once.");
    dates.set(day, text(notice, "Closed date notice", 280));
  }
  return {
    expectedVersion,
    paused,
    firstTime,
    lastTime,
    notice: text(data.notice, "Booking notice", 280),
    closures: [...dates]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, notice]) => ({ date, notice })),
  };
}

async function readReservationSettings(db: Pick<Pool, "query">) {
  const {
    rows: [settings],
  } = await db.query<VersionedSettings>(
    `SELECT ${settingsColumns}, COALESCE((
       SELECT jsonb_agg(jsonb_build_object('date',to_char(closed_date,'YYYY-MM-DD'),'notice',notice) ORDER BY closed_date)
       FROM guest_reservation_closures
     ), '[]'::jsonb) AS closures FROM guest_reservation_settings WHERE singleton`,
  );
  if (!settings)
    fail(
      503,
      "RESERVATION_SETTINGS_UNAVAILABLE",
      "Booking settings are temporarily unavailable.",
    );
  return settings;
}

async function checkReservationAvailability(
  db: PoolClient,
  date: string,
  time: string,
  guest: boolean,
) {
  const {
    rows: [settings],
  } = await db.query<SettingsRow>(
    `SELECT ${settingsColumns} FROM guest_reservation_settings WHERE singleton FOR SHARE`,
  );
  if (!settings)
    fail(
      503,
      "RESERVATION_SETTINGS_UNAVAILABLE",
      "Booking settings are temporarily unavailable.",
    );
  if (guest && settings.paused)
    fail(
      409,
      "RESERVATIONS_PAUSED",
      settings.notice || "Online table requests are temporarily paused.",
    );
  // Hold the settings lock until the booking commits. A concurrent settings save
  // cannot change closures or hours between this check and the reservation write.
  const {
    rows: [closure],
  } = await db.query<{ notice: string }>(
    "SELECT notice FROM guest_reservation_closures WHERE closed_date=$1",
    [date],
  );
  if (closure)
    fail(
      409,
      "RESERVATION_DATE_CLOSED",
      closure.notice ||
        "Table requests are closed on this date. Choose another date.",
    );
  if (time < settings.firstTime || time > settings.lastTime) {
    fail(
      409,
      "RESERVATION_HOURS",
      `Choose a seating time from ${settings.firstTime} to ${settings.lastTime} (Toronto time).`,
    );
  }
}
async function submissionLimit(
  client: PoolClient,
  channel: string,
  email: string,
  request: Request,
) {
  // Only hashes persist; forwarded headers are intentionally ignored.
  for (const [key, maximum] of [
    [`${channel}:ip:${request.socket.remoteAddress ?? "unknown"}`, 10],
    [`${channel}:email:${email}`, 3],
  ] as const) {
    const {
      rows: [row],
    } = await client.query<{ count: number }>(
      `INSERT INTO guest_submission_limits(key_hash,window_start,count)
      VALUES($1,date_trunc('hour',now()),1) ON CONFLICT(key_hash) DO UPDATE SET
      count=CASE WHEN guest_submission_limits.window_start=EXCLUDED.window_start THEN guest_submission_limits.count+1 ELSE 1 END,
      window_start=EXCLUDED.window_start RETURNING count`,
      [digest(key)],
    );
    if (row.count > maximum)
      fail(
        429,
        "TOO_MANY_REQUESTS",
        "Too many requests. Please try again in an hour or contact the restaurant directly.",
      );
  }
  await client.query(
    "DELETE FROM guest_submission_limits WHERE window_start < now() - interval '2 days'",
  );
}
async function event(
  client: PoolClient,
  row: ReservationRow,
  action: string,
  actor: string | null,
) {
  await client.query(
    `INSERT INTO guest_reservation_events(reservation_id,version,action,status,reservation_date,reservation_time,starts_at,party_size,message,actor_account_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      row.id,
      row.version,
      action,
      row.status,
      row.date,
      row.time,
      row.starts_at,
      row.party_size,
      row.last_message,
      actor,
    ],
  );
}
class AttemptLimit {
  private readonly windows = new Map<
    string,
    { count: number; until: number }
  >();
  take(key: string, max: number) {
    const now = Date.now();
    for (const [entry, value] of this.windows)
      if (value.until <= now) this.windows.delete(entry);
    if (!this.windows.has(key) && this.windows.size >= 10_000)
      fail(429, "TOO_MANY_REQUESTS", "Please try again later.");
    const window = this.windows.get(key) ?? {
      count: 0,
      until: now + 15 * 60_000,
    };
    if (++window.count > max)
      fail(
        429,
        "TOO_MANY_REQUESTS",
        "Too many attempts. Please try again in 15 minutes.",
      );
    this.windows.set(key, window);
  }
}

@Controller("v1")
export class GuestServicesController {
  private readonly attempts = new AttemptLimit();
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get("guest-services/config")
  async config() {
    let ready = false;
    let reservationsEnabled = false;
    let reservationSettings = defaultReservationSettings;
    try {
      const db = this.auth.database();
      const {
        rows: [row],
      } =
        await db.query(`SELECT to_regclass('public.guest_reservations') IS NOT NULL
      AND to_regclass('public.guest_contact_messages') IS NOT NULL AND to_regclass('public.notification_emails') IS NOT NULL AS ready`);
      ready = Boolean(row.ready);
      if (ready) {
        const { paused, notice, firstTime, lastTime, closures } =
          await readReservationSettings(db);
        reservationSettings = { paused, notice, firstTime, lastTime, closures };
        reservationsEnabled = true;
      }
    } catch {
      /* The hosted/unconfigured preview stays closed. */
    }
    return {
      contactEnabled: ready,
      reservationsEnabled,
      reservationSettings,
      emailEnabled: ready && emailConfigured(),
      mode: "LOCAL_PREVIEW",
      timeZone: TIME_ZONE,
      maxPartySize: 20,
      maxAdvanceDays: 180,
      minLeadMinutes: 60,
      timeStepMinutes: 15,
    };
  }
  private check(request: Request) {
    this.auth.checkOrigin(request);
    this.attempts.take(request.socket.remoteAddress ?? "unknown", 60);
  }
  @Post("contact")
  async contact(@Body() body: unknown, @Req() request: Request) {
    this.check(request);
    const data = object(body, [
      "name",
      "email",
      "phone",
      "subject",
      "message",
      "requestId",
    ]);
    const input = {
      ...guest(data, false),
      subject: text(data.subject, "Subject", 120),
      message: text(data.message, "Message", 3000, 10, true),
    };
    const requestHash = digest("contact:" + input.requestId);
    const fingerprint = digest(JSON.stringify(input));
    const row = await transaction(this.auth.database(), async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [requestHash],
      );
      const prior = await client.query<ContactRow>(
        "SELECT * FROM guest_contact_messages WHERE request_hash=$1",
        [requestHash],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_fingerprint !== fingerprint)
          fail(
            409,
            "REQUEST_REUSED",
            "This request ID was already used with different details. Start a new request.",
          );
        return prior.rows[0];
      }
      await submissionLimit(client, "contact", input.email, request);
      const {
        rows: [saved],
      } = await client.query<ContactRow>(
        `INSERT INTO guest_contact_messages(request_hash,request_fingerprint,name,email,phone,subject,message,notification_mode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          requestHash,
          fingerprint,
          input.name,
          input.email,
          input.phone,
          input.subject,
          input.message,
          notificationIntent().notificationMode,
        ],
      );
      const number = `C-${saved.message_number}`;
      await enqueueEmail(client, {
        to: input.email,
        subject: `Wok & Chop: enquiry received (${number})`,
        text: `We received your message, reference ${number}. The restaurant team will review it. This acknowledgement confirms receipt only.`,
      });
      await enqueueEmail(client, {
        to: staffEmail,
        replyTo: input.email,
        subject: `New contact enquiry ${number}`,
        text: `A new contact enquiry ${number} is waiting in the staff contact inbox. Open the inbox to read the message and reply. Customer text and phone details are kept in the inbox.`,
      });
      return saved;
    });
    return {
      contact: { number: `C-${row.message_number}`, status: "RECEIVED" },
      ...notificationIntent(row.notification_mode),
    };
  }
  @Post("reservations")
  async reserve(@Body() body: unknown, @Req() request: Request) {
    this.check(request);
    const data = object(body, [
      "name",
      "email",
      "phone",
      "date",
      "time",
      "partySize",
      "notes",
      "requestId",
    ]);
    const startsAt = torontoInstant(data.date, data.time);
    const input = {
      ...guest(data, true),
      date: data.date as string,
      time: data.time as string,
      partySize: party(data.partySize),
      notes: text(data.notes, "Reservation notes", 1000, 0, true),
    };
    const requestHash = digest("reservation:" + input.requestId);
    const fingerprint = digest(JSON.stringify(input));
    const row = await transaction(this.auth.database(), async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [requestHash],
      );
      const prior = await client.query<ReservationRow>(
        `SELECT ${reservationColumns} FROM guest_reservations r WHERE request_hash=$1`,
        [requestHash],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_fingerprint !== fingerprint)
          fail(
            409,
            "REQUEST_REUSED",
            "This request ID was already used with different details. Start a new request.",
          );
        return prior.rows[0];
      }
      future(startsAt);
      await checkReservationAvailability(client, input.date, input.time, true);
      await submissionLimit(client, "reservation", input.email, request);
      const {
        rows: [saved],
      } = await client.query<ReservationRow>(
        `INSERT INTO guest_reservations AS r(request_hash,request_fingerprint,name,email,phone,notes,reservation_date,reservation_time,starts_at,party_size,notification_mode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${reservationColumns}`,
        [
          requestHash,
          fingerprint,
          input.name,
          input.email,
          input.phone,
          input.notes,
          input.date,
          input.time,
          startsAt,
          input.partySize,
          notificationIntent().notificationMode,
        ],
      );
      await event(client, saved, "REQUEST", null);
      const detail = `${input.partySize} guests on ${input.date} at ${input.time} (${TIME_ZONE})`;
      await enqueueEmail(client, {
        to: input.email,
        subject: `Wok & Chop: reservation request R-${saved.reservation_number}`,
        text: `We received request R-${saved.reservation_number} for ${detail}. This is not a confirmed reservation. The restaurant team will review it and send a decision.`,
      });
      await enqueueEmail(client, {
        to: staffEmail,
        replyTo: input.email,
        subject: `New reservation request R-${saved.reservation_number}`,
        text: `Request R-${saved.reservation_number}: ${detail}. Open staff reservations to review and confirm, reschedule or decline. No table has been confirmed automatically.`,
      });
      return saved;
    });
    return {
      reservation: publicReservation(row),
      ...notificationIntent(row.notification_mode),
    };
  }
}

@Controller("v1/auth/admin")
export class ManagerGuestServicesController {
  private readonly attempts = new AttemptLimit();
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get("reservations/settings")
  async settings(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return readReservationSettings(
      await this.auth.managerDatabase(request, response),
    );
  }
  @Post("reservations/settings")
  @HttpCode(200)
  async updateSettings(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.checkOrigin(request);
    const { pool, accountId } = await this.auth.managerAccess(
      request,
      response,
    );
    this.attempts.take(accountId, 120);
    const changes = availabilityUpdate(body);
    return transaction(pool, async (client) => {
      const {
        rows: [saved],
      } = await client.query<SettingsRow>(
        `UPDATE guest_reservation_settings SET paused=$2,notice=$3,first_time=$4,last_time=$5,
           updated_by=$6, updated_at=now(), version=version+1
         WHERE singleton AND version=$1 RETURNING ${settingsColumns}`,
        [
          changes.expectedVersion,
          changes.paused,
          changes.notice,
          changes.firstTime,
          changes.lastTime,
          accountId,
        ],
      );
      if (!saved)
        fail(
          409,
          "VERSION_CONFLICT",
          "Another staff member updated the booking settings. Reload before saving.",
        );
      await client.query("DELETE FROM guest_reservation_closures");
      await client.query(
        `INSERT INTO guest_reservation_closures(closed_date,notice) SELECT * FROM unnest($1::date[],$2::text[])`,
        [
          changes.closures.map((closure) => closure.date),
          changes.closures.map((closure) => closure.notice),
        ],
      );
      return { ...saved, closures: changes.closures };
    });
  }
  @Get("reservations")
  async list(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("scope") scope: unknown = "active",
    @Query("after") after?: unknown,
  ) {
    const db = await this.auth.managerDatabase(request, response);
    if (scope !== "active" && scope !== "all")
      fail(400, "INVALID_SCOPE", "Choose active or all reservations.");
    if (after !== undefined && (typeof after !== "string" || !UUID.test(after)))
      fail(400, "INVALID_CURSOR", "Invalid reservation cursor.");
    const { rows } = await db.query<ReservationRow>(
      `SELECT ${reservationColumns} FROM guest_reservations r
      WHERE ($1='all' OR r.status IN ('REQUESTED','CONFIRMED')) AND ($2::uuid IS NULL OR r.reservation_number < (SELECT reservation_number FROM guest_reservations WHERE id=$2))
      ORDER BY r.reservation_number DESC LIMIT 26`,
      [scope, after ?? null],
    );
    return {
      reservations: rows.slice(0, 25).map(staffReservation),
      nextCursor: rows.length > 25 ? rows[24].id : null,
    };
  }
  @Get("contact")
  async contact(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("after") after?: unknown,
  ) {
    const db = await this.auth.managerDatabase(request, response);
    if (after !== undefined && (typeof after !== "string" || !UUID.test(after)))
      fail(400, "INVALID_CURSOR", "Invalid inbox cursor.");
    const { rows } = await db.query<ContactRow>(
      `SELECT * FROM guest_contact_messages WHERE ($1::uuid IS NULL OR message_number < (SELECT message_number FROM guest_contact_messages WHERE id=$1)) ORDER BY message_number DESC LIMIT 26`,
      [after ?? null],
    );
    return {
      contacts: rows.slice(0, 25).map((row) => ({
        id: row.id,
        number: `C-${row.message_number}`,
        name: row.name,
        email: row.email,
        phone: row.phone,
        subject: row.subject,
        message: row.message,
        createdAt: row.created_at,
      })),
      nextCursor: rows.length > 25 ? rows[24].id : null,
    };
  }
  @Post("reservations/:id")
  @HttpCode(200)
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.checkOrigin(request);
    const { pool, accountId } = await this.auth.managerAccess(
      request,
      response,
    );
    this.attempts.take(accountId, 120);
    if (!UUID.test(id))
      fail(400, "INVALID_RESERVATION", "Invalid reservation.");
    const data = object(body, [
      "version",
      "action",
      "date",
      "time",
      "partySize",
      "message",
    ]);
    if (!Number.isSafeInteger(data.version) || Number(data.version) < 1)
      fail(
        400,
        "INVALID_VERSION",
        "Reload this reservation before making a decision.",
      );
    if (
      typeof data.action !== "string" ||
      !["CONFIRM", "RESCHEDULE", "DECLINE", "CANCEL"].includes(data.action)
    )
      fail(400, "INVALID_ACTION", "Choose a valid reservation action.");
    const action = data.action as
      | "CONFIRM"
      | "RESCHEDULE"
      | "DECLINE"
      | "CANCEL";
    const message = text(
      data.message,
      "Message to the guest",
      500,
      action === "DECLINE" || action === "CANCEL" ? 1 : 0,
      true,
    );
    if (
      action !== "RESCHEDULE" &&
      [data.date, data.time, data.partySize].some(
        (value) => value !== undefined,
      )
    )
      fail(
        400,
        "INVALID_INPUT",
        "Use Reschedule to change the date, time or party size.",
      );
    const row = await transaction(pool, async (client) => {
      const {
        rows: [current],
      } = await client.query<ReservationRow>(
        `SELECT ${reservationColumns} FROM guest_reservations r WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!current)
        fail(404, "RESERVATION_NOT_FOUND", "Reservation not found.");
      if (current.version !== data.version)
        fail(
          409,
          "VERSION_CONFLICT",
          "Another staff member updated this reservation. Reload before continuing.",
        );
      if (
        !["REQUESTED", "CONFIRMED"].includes(current.status) ||
        (action === "CONFIRM" && current.status !== "REQUESTED") ||
        (action === "DECLINE" && current.status !== "REQUESTED")
      )
        fail(
          409,
          "INVALID_TRANSITION",
          "This reservation cannot take that action. Reload its current status.",
        );
      const startsAt =
        action === "RESCHEDULE"
          ? torontoInstant(data.date, data.time)
          : current.starts_at;
      const size =
        action === "RESCHEDULE" && data.partySize !== undefined
          ? party(data.partySize)
          : current.party_size;
      if (action === "CONFIRM" || action === "RESCHEDULE") future(startsAt);
      const date =
        action === "RESCHEDULE" ? (data.date as string) : current.date;
      const time =
        action === "RESCHEDULE" ? (data.time as string) : current.time;
      if (action === "CONFIRM" || action === "RESCHEDULE") {
        await checkReservationAvailability(client, date, time, false);
      }
      if (
        action === "RESCHEDULE" &&
        date === current.date &&
        time === current.time &&
        size === current.party_size
      )
        fail(
          400,
          "NO_CHANGE",
          "Change the date, time or party size before rescheduling.",
        );
      const status: Status =
        action === "DECLINE"
          ? "DECLINED"
          : action === "CANCEL"
            ? "CANCELLED"
            : "CONFIRMED";
      const {
        rows: [updated],
      } = await client.query<ReservationRow>(
        `UPDATE guest_reservations r SET status=$2,reservation_date=$3,reservation_time=$4,starts_at=$5,party_size=$6,last_message=$7,notification_mode=$8,version=version+1,updated_at=now() WHERE id=$1 RETURNING ${reservationColumns}`,
        [
          id,
          status,
          date,
          time,
          startsAt,
          size,
          message,
          notificationIntent().notificationMode,
        ],
      );
      await event(client, updated, action, accountId);
      const wording =
        action === "RESCHEDULE"
          ? "rescheduled and confirmed"
          : status.toLowerCase();
      await enqueueEmail(client, {
        to: updated.email,
        subject: `Wok & Chop: reservation R-${updated.reservation_number} ${wording}`,
        text: `Reservation R-${updated.reservation_number} has been ${wording}.\n${size} guests on ${date} at ${time} (${TIME_ZONE}).${message ? `\n\nMessage from the restaurant:\n${message}` : ""}`,
      });
      return updated;
    });
    return {
      reservation: staffReservation(row),
      ...notificationIntent(row.notification_mode),
    };
  }
}
