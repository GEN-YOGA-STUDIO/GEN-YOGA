import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  HttpError,
  assertAllowedOrigin,
  assertPaymentOrigin,
  corsHeaders,
  createAdminClient,
  getAuthenticatedUser,
  handleOptions,
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  requirePost,
  safeErrorResponse,
  sha256Hex,
} from "../_shared/stripe-production.ts"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizePersonName(value: unknown, label: string, maxLength: number, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${label} es obligatorio.`)
    return ''
  }
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}<>&]/u.test(value)) {
    throw new HttpError(400, `${label} no es válido.`)
  }
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (!normalized) {
    if (required) throw new HttpError(400, `${label} es obligatorio.`)
    return ''
  }
  if ([...normalized].length > maxLength) {
    throw new HttpError(400, `${label} no puede superar ${maxLength} caracteres.`)
  }
  return normalized
}

serve(async (req) => {
  let headers: Record<string, string> = {}
  try {
    const corsConfig = readCorsConfig()
    headers = corsHeaders(req, corsConfig)
    const preflight = handleOptions(req, corsConfig)
    if (preflight) return preflight

    assertAllowedOrigin(req, corsConfig)
    requirePost(req)
    const config = readProductionConfig()
    assertPaymentOrigin(req, config)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'El cuerpo de la solicitud no es válido.')
    }

    const classId = Number(body.clase_id)
    if (!Number.isSafeInteger(classId) || classId <= 0) {
      throw new HttpError(400, 'La clase seleccionada no es válida.')
    }
    const nombre = normalizePersonName(body.nombre, 'El nombre', 80, true)
    const apellidos = normalizePersonName(body.apellidos, 'Los apellidos', 120, false)
    const guestEmail = String(body.email || '').trim().toLowerCase()
    if (guestEmail && (guestEmail.length > 254 || !EMAIL_PATTERN.test(guestEmail))) {
      throw new HttpError(400, 'El correo del invitado no es válido.')
    }

    const supabase = createAdminClient(config)
    const owner = await getAuthenticatedUser(req, supabase, true)
    const { data: ownerProfile, error: ownerError } = await supabase
      .from('profiles')
      .select('bono_mensual_activo, bono_mensual_inicio, bono_mensual_fin, account_deletion_pending')
      .eq('id', owner!.id)
      .single()
    if (ownerError || !ownerProfile) throw new Error('No se pudo cargar el Bono Ilimitado.')
    if (ownerProfile.account_deletion_pending) {
      throw new HttpError(409, 'La cuenta se está eliminando y no puede usar beneficios.')
    }
    const { data: selectedClass, error: classError } = await supabase
      .from('clases')
      .select('fecha_inicio, tipo_clase')
      .eq('id', classId)
      .single()
    if (classError || !selectedClass?.fecha_inicio) {
      throw new HttpError(409, 'La clase seleccionada ya no está disponible.')
    }
    if (String(selectedClass.tipo_clase || '').toLowerCase() !== 'yoga') {
      throw new HttpError(409, 'El invitado gratuito no se puede usar en clases especiales.')
    }

    const classStartsAt = String(selectedClass.fecha_inicio)
    const classDate = new Date(classStartsAt)
    let classMonthDate = ''
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit'
      }).formatToParts(classDate)
      const year = parts.find((p) => p.type === 'year')?.value
      const month = parts.find((p) => p.type === 'month')?.value
      if (year && month) classMonthDate = `${year}-${month}-01`
    } catch (_) {
      classMonthDate = `${classDate.getFullYear()}-${String(classDate.getMonth() + 1).padStart(2, '0')}-01`
    }

    let naturalMonth: { starts_at: string; ends_at: string } | null = null
    const { data: monthByRange, error: rangeError } = await supabase
      .from('unlimited_membership_periods')
      .select('starts_at, ends_at')
      .eq('user_id', owner!.id)
      .lte('starts_at', classStartsAt)
      .gt('ends_at', classStartsAt)
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (rangeError) throw new Error('No se pudo comprobar el mes natural del Bono Ilimitado.')
    naturalMonth = monthByRange

    if (!naturalMonth && classMonthDate) {
      const { data: monthByMonth, error: monthError } = await supabase
        .from('unlimited_membership_periods')
        .select('starts_at, ends_at')
        .eq('user_id', owner!.id)
        .eq('membership_month', classMonthDate)
        .maybeSingle()
      if (!monthError && monthByMonth) {
        naturalMonth = monthByMonth
      }
    }

    let membershipStart = naturalMonth?.starts_at || null
    let membershipEnd = naturalMonth?.ends_at || null
    if (!membershipStart || !membershipEnd) {
      const legacyStart = ownerProfile.bono_mensual_inicio
      const legacyEnd = ownerProfile.bono_mensual_fin
      const classTime = Date.parse(classStartsAt)
      if (
        ownerProfile.bono_mensual_activo && legacyStart && legacyEnd &&
        classTime >= Date.parse(String(legacyStart)) && classTime < Date.parse(String(legacyEnd))
      ) {
        membershipStart = legacyStart
        membershipEnd = legacyEnd
      }
    }
    if (!membershipStart || !membershipEnd) {
      throw new HttpError(409, 'La clase no está cubierta por un mes de Bono Ilimitado comprado.')
    }

    const { data: existingPass, error: passLookupError } = await supabase
      .from('unlimited_guest_passes')
      .select('reservation_id, class_id')
      .eq('owner_user_id', owner!.id)
      .eq('membership_period_start', membershipStart)
      .maybeSingle()
    if (passLookupError) throw new Error('No se pudo comprobar el beneficio de invitado.')
    if (existingPass) {
      if (Number(existingPass.class_id) !== classId) {
        throw new HttpError(409, 'Ya has utilizado el invitado incluido en este mes natural.')
      }
      return jsonResponse({
        success: true,
        alreadyBooked: true,
        reservationId: existingPass.reservation_id,
      }, 200, headers)
    }

    const identityHash = await sha256Hex(
      `${owner!.id}:${membershipStart}:unlimited_guest`,
    )
    const internalEmail = `unlimited_guest_${identityHash.slice(0, 32)}@genyoga.es`
    let guestUserId: string | null = null
    let createdAuthUser = false

    const { data: existingProfile, error: existingError } = await supabase
      .from('profiles')
      .select('id, rol')
      .eq('email', internalEmail)
      .maybeSingle()
    if (existingError) throw new Error('No se pudo comprobar la identidad del invitado.')

    if (existingProfile) {
      if (existingProfile.rol !== 'cliente_temporal') {
        throw new HttpError(409, 'La identidad temporal del invitado no es válida.')
      }
      guestUserId = existingProfile.id
    } else {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: internalEmail,
        email_confirm: true,
        user_metadata: { nombre, apellidos, unlimited_guest_owner: owner!.id },
      })
      if (authError || !authData.user) throw new Error('No se pudo crear el invitado temporal.')
      guestUserId = authData.user.id
      createdAuthUser = true
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: guestUserId,
        email: internalEmail,
        nombre,
        apellidos,
        rol: 'cliente_temporal',
        bonos: 0,
      })
      if (profileError) {
        await supabase.auth.admin.deleteUser(guestUserId)
        throw new Error('No se pudo crear el perfil temporal del invitado.')
      }
    }

    const fullName = `${nombre} ${apellidos}`.trim()
    const { data: reservationId, error: bookingError } = await supabase.rpc(
      'reservar_invitado_ilimitado',
      {
        p_owner_user_id: owner!.id,
        p_guest_user_id: guestUserId,
        p_clase_id: classId,
        p_guest_name: fullName,
        p_guest_email: guestEmail || null,
      },
    )
    if (bookingError) {
      if (createdAuthUser && guestUserId) await supabase.auth.admin.deleteUser(guestUserId)
      const message = bookingError.message || ''
      if (/allowance already used/i.test(message)) {
        throw new HttpError(409, 'Ya has utilizado el invitado incluido en este mes natural.')
      }
      if (/not active|outside the current membership/i.test(message)) {
        throw new HttpError(409, 'La clase no está cubierta por tu periodo ilimitado actual.')
      }
      if (/regular yoga classes/i.test(message)) {
        throw new HttpError(409, 'El invitado gratuito no se puede usar en clases especiales.')
      }
      if (/full/i.test(message)) throw new HttpError(409, 'La clase ya está completa.')
      if (/deadline/i.test(message)) throw new HttpError(409, 'La clase ya no admite reservas.')
      throw new Error(`No se pudo reservar al invitado: ${message}`)
    }

    return jsonResponse({ success: true, reservationId }, 200, headers)
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})
