import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { buildCatalog, MAX_MENU_STORAGE_BYTES, validatePatch, type MenuItemPatch, type Overrides } from "../../../packages/domain/src/catalog";
import { lunchCategories, lunchMenuItems } from "../../../packages/domain/src/lunch-menu";
import { AuthService } from "./auth";

type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];

export async function publishedPricingCatalog(db: Pool | PoolClient) {
  const { rows } = await db.query<{ item_id: string; patch: MenuItemPatch }>(
    "SELECT item_id, patch - 'image' AS patch FROM shared_preview_menu_items",
  );
  return buildCatalog(Object.fromEntries(rows.map(({ item_id, patch }) => [item_id, patch])));
}

function changeRequest(body: unknown, reset = false) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("Invalid menu update.");
  const input = body as Record<string, unknown>;
  const keys = reset ? ["expectedVersion"] : ["expectedVersion", "patch"];
  if (Object.keys(input).some((key) => !keys.includes(key)) || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1)
    throw new BadRequestException("Provide the menu version you reviewed.");
  let patch: MenuItemPatch = {};
  if (!reset) {
    try {
      patch = validatePatch(input.patch);
      if (!Object.keys(patch).length) throw new Error("Provide a menu change.");
      if (patch.categoryId && !lunchCategories.some((category) => category.id === patch.categoryId))
        throw new Error("Choose a lunch category.");
      if (patch.priceCents === 0) throw new Error("The lunch price must be at least one cent.");
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid menu changes.");
    }
  }
  return { expectedVersion: Number(input.expectedVersion), patch };
}

@Controller("v1")
export class PublishedMenuController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("menu")
  async published(@Query("after") after?: string) {
    const revision = typeof after === "string" && /^\d{1,9}$/.test(after) ? Number(after) : 0;
    const { rows } = await this.auth.database().query<{version: number; overrides: Overrides | null}>(
      `SELECT version, CASE WHEN version = $1 THEN NULL ELSE
        COALESCE((SELECT jsonb_object_agg(item_id,patch) FROM shared_preview_menu_items), '{}'::jsonb)
        END AS overrides FROM shared_preview_menu WHERE singleton`, [revision],
    );
    return rows[0];
  }

  @Get("auth/admin/menu")
  async access(@Req() request: Request, @Res({passthrough:true}) response: Response) {
    await this.auth.managerAccess(request, response);
    return { canPublish: true };
  }

  @Post("auth/admin/menu/items/:id")
  @HttpCode(200)
  async save(@Param("id") id: string, @Body() body: unknown, @Req() request: Request, @Res({passthrough:true}) response: Response) {
    this.auth.checkOrigin(request);
    const { pool, accountId } = await this.auth.managerAccess(request, response);
    if (!lunchMenuItems.some((item) => item.id === id)) throw new NotFoundException("Unknown lunch dish.");
    const { expectedVersion, patch } = changeRequest(body);
    return this.write(pool, expectedVersion, async (client) => {
      await client.query(
        `INSERT INTO shared_preview_menu_items(item_id,patch,updated_by) VALUES($1,$2,$3)
         ON CONFLICT(item_id) DO UPDATE SET patch=shared_preview_menu_items.patch || EXCLUDED.patch,
           updated_by=EXCLUDED.updated_by, updated_at=now()`, [id, patch, accountId],
      );
      const { rows: [{ fits }] } = await client.query<{ fits: boolean }>(
        "SELECT coalesce(sum(octet_length(patch::text)), 0) <= $1 AS fits FROM shared_preview_menu_items",
        [MAX_MENU_STORAGE_BYTES],
      );
      if (!fits) throw new BadRequestException("The shared preview menu exceeds 2.5 MB. Use smaller images or remove a photo.");
    });
  }

  @Post("auth/admin/menu/reset")
  @HttpCode(200)
  async reset(@Body() body: unknown, @Req() request: Request, @Res({passthrough:true}) response: Response) {
    this.auth.checkOrigin(request);
    const { pool } = await this.auth.managerAccess(request, response);
    const { expectedVersion } = changeRequest(body, true);
    return this.write(pool, expectedVersion, async (client) => { await client.query("DELETE FROM shared_preview_menu_items"); });
  }

  private async write(pool: Pool, version: number, change: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{version:number}>(
        "UPDATE shared_preview_menu SET version=version+1 WHERE singleton AND version=$1 RETURNING version", [version],
      );
      if (!result.rows.length) throw new ConflictException("Another manager updated the menu. Reload the menu before publishing.");
      await change(client);
      await client.query("COMMIT");
      return { version: result.rows[0].version };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
