import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Body, Controller, Get, HttpCode, HttpException, Inject, Post, Query, Req, Res } from "@nestjs/common";
import { Pool } from "pg";
import { fetchCustomerOrders } from "./customer-orders";

type PublicUser = { id: string; name: string; email: string };
type AccountRow = { id: string; display_name: string; email_normalized: string; password_hash: string };
type RequestLike = { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } };
type ResponseLike = { setHeader(name: string, value: string): unknown };
const COOKIE_NAME = "wok_customer_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SCRYPT_COST = 32768;
const SCRYPT_OPTIONS = { N: SCRYPT_COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = Buffer.from("c56a0ed590fad543ecbe03f4d80934f2", "hex");
const DUMMY_KEY = Buffer.alloc(64);

function failure(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT_COST}$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password: string, encoded?: string) {
  const parts = encoded?.split("$");
  const valid = parts?.length === 6 && parts[0] === "scrypt" && parts[1] === String(SCRYPT_COST)
    && parts[2] === "8" && parts[3] === "1" && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  const key = await derive(password, valid ? Buffer.from(parts[4], "hex") : DUMMY_SALT);
  const matches = timingSafeEqual(key, valid ? Buffer.from(parts[5], "hex") : DUMMY_KEY);
  return Boolean(valid && matches);
}

function sessionHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function publicUser(row: AccountRow): PublicUser { return { id: row.id, name: row.display_name, email: row.email_normalized }; }
function cookieToken(request: RequestLike) {
  const raw = request.headers.cookie;
  if (typeof raw !== "string") return null;
  const value = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function sessionCookie(token: string, maxAge = SESSION_SECONDS) {
  // This service binds only to loopback and refuses production. HTTPS deployment must add Secure.
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/v1/auth; Max-Age=${maxAge}`;
}

function credentials(body: unknown, registration: boolean) {
  if (!body || typeof body !== "object" || Array.isArray(body)) failure(400, "INVALID_INPUT", "Enter your account details.");
  const data = body as Record<string, unknown>;
  const allowed = registration ? ["name", "email", "password"] : ["email", "password"];
  if (Object.keys(data).some((key) => !allowed.includes(key))) failure(400, "INVALID_INPUT", "Unexpected account fields.");
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) failure(400, "INVALID_EMAIL", "Enter a valid email address.");
  const password = typeof data.password === "string" ? data.password : "";
  if (password.length < (registration ? 12 : 1) || password.length > 128 || Buffer.byteLength(password, "utf8") > 512) {
    failure(400, "INVALID_PASSWORD", registration ? "Use a password with 12 to 128 characters." : "Enter your password.");
  }
  const name = typeof data.name === "string" ? data.name.trim().replace(/\s+/g, " ") : "";
  if (registration && (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))) failure(400, "INVALID_NAME", "Enter a name with 1 to 80 characters.");
  return { email, password, name };
}

export class AuthService {
  private readonly pool?: Pool;
  private readonly rateWindows = new Map<string, { count: number; resetAt: number }>();

  constructor(databaseUrl: string | undefined, readonly webOrigin: string) {
    const origin = new URL(webOrigin);
    if (origin.origin !== webOrigin || origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname)) {
      throw new Error("Customer account preview requires an exact loopback WEB_ORIGIN.");
    }
    if (databaseUrl) {
      const target = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(target.protocol)
        || !["127.0.0.1", "localhost"].includes(target.hostname)
        || target.search || target.hash
        || !["/wok_chop_auth_dev", "/wok_chop_auth_test"].includes(target.pathname)) {
        // pg connection-string query parameters can override host settings; disallow them.
        throw new Error("Customer account preview requires its dedicated local PostgreSQL database without URL overrides.");
      }
      this.pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
      this.pool.on("error", () => { /* Errors are surfaced without logging connection details or account data. */ });
    }
  }

  async onModuleInit() {
    if (!this.pool) return;
    try { await this.pool.query("SELECT id FROM customer_accounts LIMIT 0"); }
    catch { throw new Error("Customer account database is unavailable or not migrated."); }
  }
  async onModuleDestroy() { await this.pool?.end(); }
  database() {
    if (!this.pool) failure(503, "ACCOUNTS_NOT_CONFIGURED", "Local account service is not configured. You can continue as a guest.");
    return this.pool;
  }
  checkOrigin(request: RequestLike) {
    if (request.headers.origin !== this.webOrigin) failure(403, "ORIGIN_REJECTED", "This account request did not come from the restaurant website.");
    if (typeof request.headers["content-type"] !== "string" || request.headers["content-type"].split(";")[0].trim().toLowerCase() !== "application/json") {
      failure(415, "JSON_REQUIRED", "Send account details as JSON.");
    }
  }
  limit(request: RequestLike) {
    const now = Date.now();
    for (const [key, window] of this.rateWindows) if (window.resetAt <= now) this.rateWindows.delete(key);
    const key = request.socket.remoteAddress ?? "unknown";
    const window = this.rateWindows.get(key) ?? { count: 0, resetAt: now + 15 * 60 * 1000 };
    if (window.count >= 20) failure(429, "TOO_MANY_ATTEMPTS", "Too many account attempts. Try again in 15 minutes.");
    window.count += 1;
    this.rateWindows.set(key, window);
  }
  async register(body: unknown, request: RequestLike, response: ResponseLike) {
    this.checkOrigin(request); this.limit(request);
    const data = credentials(body, true);
    const pool = this.database();
    const passwordHash = await hashPassword(data.password);
    const token = randomBytes(32).toString("hex");
    const client = await pool.connect();
    let user: PublicUser;
    try {
      await client.query("BEGIN");
      const result = await client.query<AccountRow>(
        "INSERT INTO customer_accounts(display_name,email_normalized,password_hash) VALUES($1,$2,$3) RETURNING id,display_name,email_normalized,password_hash",
        [data.name, data.email, passwordHash],
      );
      user = publicUser(result.rows[0]);
      await client.query("INSERT INTO customer_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now() + interval '7 days')", [sessionHash(token), user.id]);
      const previous = cookieToken(request);
      if (previous) await client.query("UPDATE customer_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL", [sessionHash(previous)]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") failure(409, "ACCOUNT_EXISTS", "An account already uses this email. Sign in instead.");
      throw error;
    } finally { client.release(); }
    response.setHeader("Set-Cookie", sessionCookie(token));
    response.setHeader("Cache-Control", "no-store");
    return { user };
  }
  async login(body: unknown, request: RequestLike, response: ResponseLike) {
    this.checkOrigin(request); this.limit(request);
    const data = credentials(body, false);
    const pool = this.database();
    const result = await pool.query<AccountRow>("SELECT id,display_name,email_normalized,password_hash FROM customer_accounts WHERE email_normalized=$1", [data.email]);
    const account = result.rows[0];
    if (!await verifyPassword(data.password, account?.password_hash) || !account) failure(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
    const token = randomBytes(32).toString("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO customer_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now() + interval '7 days')", [sessionHash(token), account.id]);
      const previous = cookieToken(request);
      if (previous) await client.query("UPDATE customer_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL", [sessionHash(previous)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    response.setHeader("Set-Cookie", sessionCookie(token));
    response.setHeader("Cache-Control", "no-store");
    return { user: publicUser(account) };
  }
  async me(request: RequestLike, response: ResponseLike) {
    response.setHeader("Cache-Control", "no-store");
    const pool = this.database();
    const token = cookieToken(request);
    if (!token) return { user: null };
    const result = await pool.query<AccountRow>(
      "SELECT a.id,a.display_name,a.email_normalized FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()",
      [sessionHash(token)],
    );
    if (!result.rows[0]) response.setHeader("Set-Cookie", sessionCookie("", 0));
    return { user: result.rows[0] ? publicUser(result.rows[0]) : null };
  }
  async orders(request: RequestLike, response: ResponseLike, after?: unknown) {
    const { user } = await this.me(request, response);
    if (!user) failure(401, "SIGN_IN_REQUIRED", "Sign in to view your order history.");
    return fetchCustomerOrders(this.database(), user.id, after);
  }
  async managerAccess(request: RequestLike, response: ResponseLike) {
    const { user } = await this.me(request, response);
    if (!user) failure(401, "SIGN_IN_REQUIRED", "Sign in to open the customer directory.");
    const pool = this.database();
    const role = await pool.query("SELECT 1 FROM restaurant_managers WHERE account_id=$1", [user.id]);
    if (!role.rowCount) failure(403, "MANAGER_REQUIRED", "This account does not have manager access.");
    return { pool, accountId: user.id };
  }
  async managerDatabase(request: RequestLike, response: ResponseLike): Promise<Pool> {
    return (await this.managerAccess(request, response)).pool;
  }
  async logout(request: RequestLike, response: ResponseLike) {
    this.checkOrigin(request);
    const pool = this.database();
    const token = cookieToken(request);
    if (token) await pool.query("UPDATE customer_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL", [sessionHash(token)]);
    response.setHeader("Set-Cookie", sessionCookie("", 0));
    response.setHeader("Cache-Control", "no-store");
    return { ok: true };
  }
}

@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post("register")
  register(@Body() body: unknown, @Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    return this.auth.register(body, request, response);
  }
  @Post("login") @HttpCode(200)
  login(@Body() body: unknown, @Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    return this.auth.login(body, request, response);
  }
  @Post("logout") @HttpCode(200)
  logout(@Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) { return this.auth.logout(request, response); }
  @Get("me")
  me(@Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) { return this.auth.me(request, response); }
  @Get("orders")
  orders(@Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike, @Query("after") after?: unknown) {
    return this.auth.orders(request, response, after);
  }
}
