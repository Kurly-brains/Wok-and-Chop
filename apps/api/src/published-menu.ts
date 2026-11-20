import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  buildCatalog,
  applyMenuItemPatch,
  createCustomMenuItem,
  MAX_MENU_STORAGE_BYTES,
  validateNewMenuItem,
  validatePatch,
  type MenuItemPatch,
  type NewMenuItem,
  type Overrides,
} from "../../../packages/domain/src/catalog";
import {
  lunchCategories,
  lunchMenuItems,
} from "../../../packages/domain/src/lunch-menu";
import { AuthService } from "./auth";

type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];
type CustomDefinition = { id: string; definition: NewMenuItem };
type CustomRow = {
  item_id: string;
  definition: NewMenuItem;
  request_fingerprint: string;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const customAggregation = (pricing: boolean) =>
  `COALESCE((SELECT jsonb_agg(jsonb_build_object('id',item_id,'definition',${pricing ? "definition - 'image'" : "definition"}) ORDER BY created_at,item_id) FROM shared_preview_custom_menu_items),'[]'::jsonb)`;

export async function publishedPricingCatalog(db: Pool | PoolClient) {
  // One statement takes one PostgreSQL snapshot, avoiding mixed menu revisions.
  const {
    rows: [row],
  } = await db.query<{
    overrides: Overrides;
    custom_items: CustomDefinition[];
  }>(
    `SELECT COALESCE((SELECT jsonb_object_agg(item_id,patch - 'image') FROM shared_preview_menu_items),'{}'::jsonb) AS overrides,
     ${customAggregation(true)} AS custom_items`,
  );
  return buildCatalog(
    row.overrides,
    row.custom_items.map(({ id, definition }) =>
      createCustomMenuItem(id, definition),
    ),
  );
}

function changeRequest(body: unknown, reset = false) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("Invalid menu update.");
  const input = body as Record<string, unknown>;
  const keys = reset ? ["expectedVersion"] : ["expectedVersion", "patch"];
  if (
    Object.keys(input).some((key) => !keys.includes(key)) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    Number(input.expectedVersion) < 1 ||
    Number(input.expectedVersion) > 2_147_483_647
  )
    throw new BadRequestException("Provide the menu version you reviewed.");
  let patch: MenuItemPatch = {};
  if (!reset) {
    try {
      patch = validatePatch(input.patch);
      if (!Object.keys(patch).length) throw new Error("Provide a menu change.");
      if (
        patch.categoryId &&
        !lunchCategories.some((category) => category.id === patch.categoryId)
      )
        throw new Error("Choose a lunch category.");
      if (patch.priceCents === 0)
        throw new Error("The lunch price must be at least one cent.");
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid menu changes.",
      );
    }
  }
  return { expectedVersion: Number(input.expectedVersion), patch };
}

function createRequest(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("Enter the new dish details.");
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["expectedVersion", "requestId", "item"].includes(key),
    ) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    Number(input.expectedVersion) < 1 ||
    Number(input.expectedVersion) > 2_147_483_647
  )
    throw new BadRequestException("Provide the menu version you reviewed.");
  if (
    typeof input.requestId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId)
  )
    throw new BadRequestException("A valid new-dish request ID is required.");
  try {
    const item = validateNewMenuItem(input.item);
    if (item.archived !== undefined) throw new Error("Publish the dish before archiving it.");
    return {
      expectedVersion: Number(input.expectedVersion),
      requestId: input.requestId.toLowerCase(),
      item,
    };
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : "Invalid new dish details.",
    );
  }
}

async function checkStorage(client: PoolClient) {
  const {
    rows: [{ fits }],
  } = await client.query<{ fits: boolean }>(
    `SELECT
    COALESCE((SELECT sum(octet_length(patch::text)) FROM shared_preview_menu_items),0)
    + COALESCE((SELECT sum(octet_length(definition::text)) FROM shared_preview_custom_menu_items),0) <= $1 AS fits`,
    [MAX_MENU_STORAGE_BYTES],
  );
  if (!fits)
    throw new BadRequestException(
      "The shared menu exceeds 2.5 MB. Use smaller images or remove a photo.",
    );
}

@Controller("v1")
export class PublishedMenuController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("menu")
  async published(@Query("after") after?: string) {
    const revision =
      typeof after === "string" && /^\d{1,9}$/.test(after) ? Number(after) : 0;
    const {
      rows: [row],
    } = await this.auth.database().query<{
      version: number;
      overrides: Overrides | null;
      custom_items: CustomDefinition[] | null;
    }>(
      `SELECT version, CASE WHEN version=$1 THEN NULL ELSE COALESCE((SELECT jsonb_object_agg(item_id,patch) FROM shared_preview_menu_items),'{}'::jsonb) END AS overrides,
       CASE WHEN version=$1 THEN NULL ELSE ${customAggregation(false)} END AS custom_items FROM shared_preview_menu WHERE singleton`,
      [revision],
    );
    if (!row)
      throw new ServiceUnavailableException(
        "The shared menu is not configured.",
      );
    return {
      version: row.version,
      overrides: row.overrides,
      customItems:
        row.custom_items?.map(({ id, definition }) =>
          createCustomMenuItem(id, definition),
        ) ?? null,
    };
  }

  @Get("auth/admin/menu")
  async access(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.managerAccess(request, response);
    return { canPublish: true, canCreate: true };
  }

  @Post("auth/admin/menu/items")
  async create(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.checkOrigin(request);
    const { pool, accountId } = await this.auth.managerAccess(
      request,
      response,
    );
    const input = createRequest(body);
    const requestHash = hash(`menu-create:${accountId}:${input.requestId}`);
    const fingerprint = hash(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(input.item).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      ),
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [requestHash],
      );
      const {
        rows: [prior],
      } = await client.query<CustomRow>(
        "SELECT item_id,definition,request_fingerprint FROM shared_preview_custom_menu_items WHERE create_request_hash=$1",
        [requestHash],
      );
      if (prior) {
        if (prior.request_fingerprint !== fingerprint)
          throw new ConflictException(
            "This request ID was already used with different dish details. Start a new dish request.",
          );
        const {
          rows: [revision],
        } = await client.query<{ version: number }>(
          "SELECT version FROM shared_preview_menu WHERE singleton FOR UPDATE",
        );
        const {
          rows: [override],
        } = await client.query<{ patch: MenuItemPatch }>(
          "SELECT patch FROM shared_preview_menu_items WHERE item_id=$1",
          [prior.item_id],
        );
        const item = buildCatalog(
          override ? { [prior.item_id]: override.patch } : {},
          [createCustomMenuItem(prior.item_id, prior.definition)],
        ).find((entry) => entry.id === prior.item_id)!;
        await client.query("COMMIT");
        return { version: revision.version, item };
      }
      const {
        rows: [revision],
      } = await client.query<{ version: number }>(
        "UPDATE shared_preview_menu SET version=version+1 WHERE singleton AND version=$1 RETURNING version",
        [input.expectedVersion],
      );
      if (!revision)
        throw new ConflictException(
          "Another manager updated the menu. Reload the menu before publishing.",
        );
      const {
        rows: [{ count }],
      } = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM shared_preview_custom_menu_items",
      );
      if (count >= 200)
        throw new BadRequestException(
          "The shared menu supports up to 200 added dishes.",
        );
      const item = createCustomMenuItem(
        `lunch-custom-${randomUUID()}`,
        input.item,
      );
      await client.query(
        `INSERT INTO shared_preview_custom_menu_items(item_id,definition,create_request_hash,request_fingerprint,created_by)
        VALUES($1,$2,$3,$4,$5)`,
        [item.id, input.item, requestHash, fingerprint, accountId],
      );
      await checkStorage(client);
      await client.query("COMMIT");
      return { version: revision.version, item };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @Post("auth/admin/menu/items/:id")
  @HttpCode(200)
  async save(
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
    const { expectedVersion, patch } = changeRequest(body);
    return this.write(pool, expectedVersion, async (client) => {
      if (!lunchMenuItems.some((item) => item.id === id)) {
        const found = await client.query(
          "SELECT 1 FROM shared_preview_custom_menu_items WHERE item_id=$1",
          [id],
        );
        if (!found.rowCount) throw new NotFoundException("Unknown lunch dish.");
      }
      const current = (await publishedPricingCatalog(client)).find(item => item.id === id);
      if (!current) throw new NotFoundException("Unknown lunch dish.");
      try {
        const updated = applyMenuItemPatch(current, patch);
        if (patch.modifierGroupIds !== undefined) patch.modifierGroupIds = updated.modifierGroupIds;
        if (patch.modifierPriceOverrides !== undefined || patch.modifierGroupIds !== undefined || patch.categoryId !== undefined) {
          patch.modifierPriceOverrides = updated.modifierPriceOverrides;
        }
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Invalid menu option settings.");
      }
      await client.query(
        `INSERT INTO shared_preview_menu_items(item_id,patch,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(item_id) DO UPDATE SET patch=shared_preview_menu_items.patch || EXCLUDED.patch,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [id, patch, accountId],
      );
      await checkStorage(client);
    });
  }

  @Post("auth/admin/menu/reset")
  @HttpCode(200)
  async reset(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.checkOrigin(request);
    const { pool } = await this.auth.managerAccess(request, response);
    const { expectedVersion } = changeRequest(body, true);
    // Keep archived dishes and their saved details available for restoration.
    return this.write(pool, expectedVersion, async (client) => {
      await client.query(
        "DELETE FROM shared_preview_menu_items WHERE patch->>'archived' IS DISTINCT FROM 'true'",
      );
    });
  }

  private async write(
    pool: Pool,
    version: number,
    change: (client: PoolClient) => Promise<void>,
  ) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ version: number }>(
        "UPDATE shared_preview_menu SET version=version+1 WHERE singleton AND version=$1 RETURNING version",
        [version],
      );
      if (!result.rows.length)
        throw new ConflictException(
          "Another manager updated the menu. Reload the menu before publishing.",
        );
      await change(client);
      await client.query("COMMIT");
      return { version: result.rows[0].version };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
