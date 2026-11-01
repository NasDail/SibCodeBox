import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ ok: false, error: message }, status);
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type AdminContext = { userId: string; role: "teacher" | "developer"; email?: string };

export async function requireAdmin(req: Request, allowedRoles?: Array<"teacher" | "developer">): Promise<{ client: SupabaseClient; admin: AdminContext }> {
  const header = req.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("AUTH_REQUIRED");
  const client = serviceClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("INVALID_AUTH_TOKEN");
  const { data: adminRow, error: adminError } = await client
    .from("admins").select("role").eq("id", data.user.id).maybeSingle();
  if (adminError || !adminRow || !["teacher", "developer"].includes(adminRow.role)) throw new Error("ADMIN_ROLE_REQUIRED");
  const role = adminRow.role as "teacher" | "developer";
  if (allowedRoles && !allowedRoles.includes(role)) throw new Error("INSUFFICIENT_ROLE");
  return { client, admin: { userId: data.user.id, role, email: data.user.email } };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid object");
    return body as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_JSON_BODY");
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(byteCount = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function normalizeNick(value: unknown): string {
  return String(value ?? "").normalize("NFKD").toLowerCase().replace(/ё/g, "е").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

export function isDeveloper(admin: AdminContext): boolean {
  return admin.role === "developer";
}

export function stringValue(value: unknown, max = 1000): string {
  return String(value ?? "").trim().slice(0, max);
}
