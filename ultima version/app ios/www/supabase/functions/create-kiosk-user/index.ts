import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const UUID_DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const MAX_INITIAL_BONUSES = 10_000;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} no está configurado.`);
  return value;
}

function createAdminClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

function normalizeAllowedOrigin(
  rawValue: string,
  variableName: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${variableName} contiene una URL no válida.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== "/")
  ) {
    throw new Error(
      `${variableName} solo puede contener orígenes HTTPS, sin rutas ni parámetros.`,
    );
  }
  return parsed.origin;
}

function readSiteOrigin(): string {
  const rawValue = requireEnv("SITE_URL");
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("SITE_URL no es una URL válida.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "SITE_URL debe ser una URL HTTPS sin credenciales ni parámetros.",
    );
  }
  return parsed.origin;
}

function readAllowedOrigins(): ReadonlySet<string> {
  const allowedOrigins = new Set([readSiteOrigin()]);
  const configuredOrigins = Deno.env.get("ALLOWED_ORIGINS")?.trim();
  if (!configuredOrigins) return allowedOrigins;

  const values = configuredOrigins.split(",").map((value) => value.trim());
  if (values.some((value) => !value) || values.length > 20) {
    throw new Error("ALLOWED_ORIGINS no tiene un formato válido.");
  }
  for (const value of values) {
    allowedOrigins.add(normalizeAllowedOrigin(value, "ALLOWED_ORIGINS"));
  }
  return allowedOrigins;
}

function corsHeaders(
  req: Request,
  allowedOrigins: ReadonlySet<string>,
): Record<string, string> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function normalizePersonName(
  value: unknown,
  fieldLabel: string,
  maxLength: number,
  required: boolean,
): string {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, `${fieldLabel} es obligatorio.`);
    return "";
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldLabel} no es válido.`);
  }

  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized) {
    if (required) throw new HttpError(400, `${fieldLabel} es obligatorio.`);
    return "";
  }
  if ([...normalized].length > maxLength) {
    throw new HttpError(
      400,
      `${fieldLabel} no puede superar ${maxLength} caracteres.`,
    );
  }
  if (/[\p{Cc}\p{Cf}<>&]/u.test(normalized)) {
    throw new HttpError(
      400,
      `${fieldLabel} contiene caracteres no permitidos (<, >, & o caracteres de control).`,
    );
  }

  return normalized;
}

function normalizeBonuses(value: unknown): number {
  const bonuses = value === undefined || value === null ? 0 : value;
  if (
    typeof bonuses !== "number" ||
    !Number.isSafeInteger(bonuses) ||
    bonuses < 0 ||
    bonuses > MAX_INITIAL_BONUSES
  ) {
    throw new HttpError(
      400,
      `Las clases sueltas iniciales deben ser un entero entre 0 y ${MAX_INITIAL_BONUSES}.`,
    );
  }
  return bonuses;
}

function uuidToBytes(value: string): Uint8Array {
  const hex = value.replace(/-/g, "");
  return Uint8Array.from(
    hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ]
    .join("-");
}

async function uuidV5(name: string): Promise<string> {
  const namespace = uuidToBytes(UUID_DNS_NAMESPACE);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(namespace.length + nameBytes.length);
  input.set(namespace);
  input.set(nameBytes, namespace.length);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function kioskErrorResponse(
  error: unknown,
  headers: Record<string, string>,
): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status, headers);
  }
  const message = error instanceof Error ? error.message : "No se pudo crear el cliente de mostrador. Inténtalo de nuevo.";
  console.error("Error interno al crear el cliente de mostrador:", error);
  return jsonResponse(
    { error: message },
    500,
    headers,
  );
}

serve(async (req) => {
  let headers: Record<string, string> = {};
  try {
    const allowedOrigins = readAllowedOrigins();
    headers = corsHeaders(req, allowedOrigins);
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") {
      if (origin && !allowedOrigins.has(origin)) {
        return jsonResponse({ error: "Origen no permitido." }, 403, headers);
      }
      return new Response("ok", { status: 200, headers });
    }
    if (origin && !allowedOrigins.has(origin)) {
      throw new HttpError(403, "Origen no permitido.");
    }
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido.");

    const supabase = createAdminClient();
    const authorization = req.headers.get("authorization") || "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    if (
      !token || token.startsWith("sb_publishable_") ||
      token.startsWith("sb_anon_")
    ) {
      throw new HttpError(401, "Debes iniciar sesión.");
    }
    const { data: authData, error: authError } = await supabase.auth.getUser(
      token,
    );
    const actor = authData.user;
    if (authError || !actor) {
      throw new HttpError(401, "La sesión de usuario no es válida.");
    }
    const { data: actorProfile, error: actorProfileError } = await supabase
      .from("profiles")
      .select("rol")
      .eq("id", actor.id)
      .maybeSingle();

    if (actorProfileError) {
      throw new Error("No se pudo comprobar el rol del usuario.");
    }
    if (!["admin", "trabajador", "profesor", "profesional"].includes(String(actorProfile?.rol || "").trim().toLowerCase())) {
      throw new HttpError(
        403,
        "Solo el personal o administración puede crear clientes de mostrador.",
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "El cuerpo de la solicitud no es válido.");
    }

    const nombre = normalizePersonName(body.nombre, "El nombre", 80, true);
    const apellidos = normalizePersonName(
      body.apellidos ?? "",
      "Los apellidos",
      120,
      false,
    );
    const fechaNacimiento = typeof body.fecha_nacimiento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha_nacimiento.trim())
      ? body.fecha_nacimiento.trim()
      : null;
    const telefono = typeof body.telefono === "string" && body.telefono.trim()
      ? body.telefono.trim().replace(/[^0-9+]/g, "")
      : null;
    const notas = typeof body.notas === "string" ? body.notas.trim() : "";
    const bonos = 0;
    const idempotencyKey = typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim()
      : "";
    if (!isUuid(idempotencyKey)) {
      throw new HttpError(
        400,
        "El identificador de la operación no es válido.",
      );
    }

    const providedEmail = typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
      ? body.email.trim().toLowerCase()
      : null;

    const operationSeed = `gen-yoga:kiosk:${actor.id}:${idempotencyKey}`;
    const fingerprint = await sha256Hex(operationSeed);
    const internalEmail = providedEmail || `mostrador+${
      fingerprint.slice(0, 32)
    }@genyoga.studio`;

    const { data: existingProfile, error: existingProfileError } =
      await supabase
        .from("profiles")
        .select("id, email, nombre, apellidos, fecha_nacimiento, telefono, notas, rol, bonos")
        .eq("email", internalEmail)
        .maybeSingle();

    if (existingProfileError) {
      throw new Error(`No se pudo comprobar la operación de alta: ${existingProfileError.message}`);
    }

    if (existingProfile) {
      return jsonResponse(
        { success: true, created: false, profile: existingProfile },
        200,
        headers,
      );
    }

    // 1. Crear el usuario en auth.users
    const randomPassword = crypto.randomUUID() + "Kiosk!1";
    let kioskUserId: string;

    const { data: newAuthUser, error: newAuthError } = await supabase.auth.admin.createUser({
      email: internalEmail,
      password: randomPassword,
      email_confirm: true,
      user_metadata: {
        nombre,
        apellidos,
        fecha_nacimiento: fechaNacimiento,
        telefono,
        notas,
        kiosk: true,
        actor_id: actor.id,
      },
    });

    if (newAuthError || !newAuthUser.user) {
      // Reintentar si ya fue creado concurrentemente
      const { data: concurrentProfile } = await supabase
        .from("profiles")
        .select("id, email, nombre, apellidos, fecha_nacimiento, telefono, notas, rol, bonos")
        .eq("email", internalEmail)
        .maybeSingle();
      if (concurrentProfile) {
        return jsonResponse(
          { success: true, created: false, profile: concurrentProfile },
          200,
          headers,
        );
      }
      throw new Error(`No se pudo crear el usuario en el sistema: ${newAuthError?.message || "error auth desconocido"}`);
    }

    kioskUserId = newAuthUser.user.id;

    // 2. Guardar o actualizar perfil en tabla profiles
    const { data: createdProfile, error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: kioskUserId,
        email: internalEmail,
        nombre,
        apellidos,
        fecha_nacimiento: fechaNacimiento,
        telefono,
        notas,
        rol: "cliente",
        bonos: 0,
        saldo_clases_gratis: 1,
        saldo_consultas_gratis: 1,
        saldo_yoga_compania: 1,
      })
      .select("id, email, nombre, apellidos, fecha_nacimiento, telefono, notas, rol, bonos")
      .single();

    if (profileError || !createdProfile) {
      throw new Error(`No se pudo guardar el perfil del cliente: ${profileError?.message || "error de base de datos"}`);
    }

    return jsonResponse(
      { success: true, created: true, profile: createdProfile },
      201,
      headers,
    );
  } catch (error) {
    return kioskErrorResponse(error, headers);
  }
});
