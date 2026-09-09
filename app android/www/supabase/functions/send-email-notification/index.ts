import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

interface NotificationPayload {
  profesional_id?: number
  evento: string
  destinatario: string
  remitente?: string
  asunto?: string
  cuerpo_html?: string
  datos?: {
    profesor_nombre?: string
    cliente_nombre?: string
    cliente_email?: string
    clase_nombre?: string
    fecha?: string
    hora?: string
    duracion?: number
    notas?: string
    es_multiple?: boolean
    slot1_info?: string
    slot2_info?: string
  }
}

function generarHtmlNotificacion(payload: NotificationPayload): { asunto: string; html: string } {
  const remitenteOficial = 'hola@genyoga.studio'
  const profNombre = payload.datos?.profesor_nombre || 'Profesional'
  const cliNombre = payload.datos?.cliente_nombre || 'Alumno/a de GEN Yoga'
  const cliEmail = payload.datos?.cliente_email || 'No especificado'
  const claseNombre = payload.datos?.clase_nombre || 'Consulta'
  const fecha = payload.datos?.fecha || ''
  const hora = payload.datos?.hora || ''
  const duracion = payload.datos?.duracion ? `${payload.datos.duracion} min` : '60 min'
  const notas = payload.datos?.notas ? `<p style="margin: 8px 0; color: #5a4b41; font-style: italic;"><strong>Notas/Ubicación:</strong> ${payload.datos.notas}</p>` : ''
  const esMultiple = !!payload.datos?.es_multiple

  let asunto = payload.asunto || ''
  let tituloHeader = ''
  let bannerTexto = ''
  let detallesEspecificos = ''

  if (payload.evento === 'prueba') {
    asunto = asunto || `[Prueba] Notificaciones configuradas con éxito - GEN Yoga`
    tituloHeader = `Verificación de Notificaciones`
    bannerTexto = `Este es un correo de prueba enviado desde <strong>${remitenteOficial}</strong> para comprobar que tu canal de alertas está activo.`
    detallesEspecificos = `
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0; color: #166534; font-weight: bold;">✓ Canal de comunicación activo y verificado</p>
        <p style="margin: 6px 0 0 0; color: #15803d; font-size: 13px;">Recibirás avisos inmediatos en este correo cada vez que se cumpla la condición configurada.</p>
      </div>
    `
  } else if (payload.evento === 'reserva_multiple') {
    asunto = asunto || `¡Sesión Múltiple Reservada! Dos citas programadas - GEN Yoga`
    tituloHeader = `Nueva Sesión Múltiple Reservada`
    bannerTexto = `Un alumno ha confirmado la reserva de una <strong>Sesión Múltiple (2 citas simultáneas)</strong> en tu consulta.`
    const s1 = payload.datos?.slot1_info || `${fecha} a las ${hora}`
    const s2 = payload.datos?.slot2_info || 'Segundo hueco vinculado'
    detallesEspecificos = `
      <div style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <span style="display: inline-block; background: #854d0e; color: #fff; font-size: 11px; font-weight: bold; padding: 2px 8px; border-radius: 6px; text-transform: uppercase;">Sesión Múltiple Vinculada</span>
        <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #713f12; font-size: 14px; line-height: 1.6;">
          <li><strong>Cita 1 (Parte 1/2):</strong> ${s1}</li>
          <li><strong>Cita 2 (Parte 2/2):</strong> ${s2}</li>
        </ul>
      </div>
    `
  } else if (payload.evento === 'cancelacion_consulta') {
    asunto = asunto || `Cancelación de cita en tu consulta - GEN Yoga`
    tituloHeader = `Cita Cancelada`
    bannerTexto = `Se ha cancelado una cita en tu consulta de <strong>${claseNombre}</strong>. El hueco ha quedado liberado.`
    detallesEspecificos = `
      <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <span style="display: inline-block; background: #991b1b; color: #fff; font-size: 11px; font-weight: bold; padding: 2px 8px; border-radius: 6px; text-transform: uppercase;">Hueco Liberado</span>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #26160C; margin-top: 10px;">
          <tr>
            <td style="padding: 6px 0; color: #8C8658; font-weight: bold; width: 140px;">📅 Fecha:</td>
            <td style="padding: 6px 0; font-weight: 600;">${fecha}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #8C8658; font-weight: bold;">⏰ Hora:</td>
            <td style="padding: 6px 0; font-weight: 600;">${hora}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #8C8658; font-weight: bold;">👤 Alumno:</td>
            <td style="padding: 6px 0; font-weight: 600;">${cliNombre}</td>
          </tr>
        </table>
      </div>
    `
  } else {
    // Evento predeterminado: reserva_consulta (hueco cubierto)
    asunto = asunto || `¡Nuevo hueco reservado en tu consulta! - GEN Yoga`
    tituloHeader = `Nuevo Hueco Reservado`
    bannerTexto = `Se ha completado la reserva de una plaza en tu consulta de <strong>${claseNombre}</strong>.`
    detallesEspecificos = `
      <div style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #26160C;">
          <tr>
            <td style="padding: 6px 0; color: #8C8658; font-weight: bold; width: 140px;">📅 Fecha:</td>
            <td style="padding: 6px 0; font-weight: 600;">${fecha}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #8C8658; font-weight: bold;">⏰ Hora:</td>
            <td style="padding: 6px 0; font-weight: 600;">${hora} (${duracion})</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #8C8658; font-weight: bold;">👤 Paciente/Alumno:</td>
            <td style="padding: 6px 0; font-weight: 600;">${cliNombre}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #8C8658; font-weight: bold;">✉️ Contacto:</td>
            <td style="padding: 6px 0;">${cliEmail}</td>
          </tr>
        </table>
        ${notas}
      </div>
    `
  }

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${asunto}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8f6f2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #26160C;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8f6f2; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px rgba(38, 22, 12, 0.06); border: 1px solid rgba(38, 22, 12, 0.08);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #26160C 0%, #4a2d1d 50%, #8C8658 100%); padding: 36px 30px; text-align: center; color: #ffffff;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase;">GEN YOGA</h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; letter-spacing: 1.5px; opacity: 0.85; text-transform: uppercase;">Estudio de Yoga & Salud Integrativa</p>
              <div style="height: 1px; width: 60px; background-color: #ffffff; opacity: 0.3; margin: 16px auto;"></div>
              <h2 style="margin: 0; font-size: 18px; font-weight: 700;">${tituloHeader}</h2>
            </td>
          </tr>

          <!-- Contenido -->
          <tr>
            <td style="padding: 32px 30px;">
              <p style="margin: 0 0 14px 0; font-size: 15px; color: #26160C; line-height: 1.5;">Hola <strong>${profNombre}</strong>,</p>
              <p style="margin: 0 0 18px 0; font-size: 14px; color: #5a4b41; line-height: 1.6;">${bannerTexto}</p>

              ${detallesEspecificos}

              <div style="margin: 28px 0 10px 0; text-align: center;">
                <a href="https://genyoga.studio/profile.html" style="display: inline-block; background-color: #26160C; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: bold; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; box-shadow: 0 4px 12px rgba(38, 22, 12, 0.2);">
                  Ver en mi Agenda Profesional →
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f6f2; padding: 22px 30px; text-align: center; border-top: 1px solid rgba(38, 22, 12, 0.08); font-size: 12px; color: #8C8658;">
              <p style="margin: 0 0 4px 0; font-weight: bold;">GEN Yoga Studio · Albacete</p>
              <p style="margin: 0; color: #9c9186;">Mensaje automático enviado desde <strong style="color: #26160C;">${remitenteOficial}</strong> según tu configuración de alertas.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `
  return { asunto, html }
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    const payload: NotificationPayload = await req.json()
    const { evento, destinatario, profesional_id } = payload

    if (!destinatario || !destinatario.includes('@')) {
      return new Response(JSON.stringify({ ok: false, error: 'Email de destinatario no válido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { asunto, html } = generarHtmlNotificacion(payload)
    const remitente = payload.remitente || 'hola@genyoga.studio'
    let entregaExitosa = false
    let proveedor = 'none'
    let errorDetalle: string | null = null

    // 1. Intentar envío vía Resend si está configurada la API key
    const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim()
    if (resendApiKey) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `GEN Yoga <${remitente}>`,
            to: [destinatario],
            subject: asunto,
            html: html
          })
        })
        const resendData = await resendRes.json()
        if (resendRes.ok) {
          entregaExitosa = true
          proveedor = 'resend'
        } else {
          errorDetalle = `Resend error: ${JSON.stringify(resendData)}`
        }
      } catch (err: any) {
        errorDetalle = `Resend fetch error: ${err.message}`
      }
    }

    // 2. Fallback de registro en base de datos si aún no hay clave externa configurada
    const estadoLog = entregaExitosa ? 'enviado' : (resendApiKey ? 'error_proveedor' : 'registrado_listo')

    try {
      await supabaseClient.from('notificaciones_email_log').insert({
        profesional_id: profesional_id || null,
        profesor_email: destinatario,
        evento: evento || 'reserva_consulta',
        destinatario: destinatario,
        remitente: remitente,
        asunto: asunto,
        cuerpo_html: html,
        estado: estadoLog,
        detalles: {
          proveedor,
          error: errorDetalle,
          datos: payload.datos || {}
        }
      })
    } catch (dbErr) {
      console.warn('No se pudo registrar log en notificaciones_email_log:', dbErr)
    }

    return new Response(JSON.stringify({
      ok: true,
      delivered: entregaExitosa,
      provider: proveedor,
      recipient: destinatario,
      sender: remitente,
      subject: asunto,
      status: estadoLog,
      message: entregaExitosa ? 'Correo enviado correctamente.' : 'Notificación procesada y registrada en el sistema de GEN Yoga.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e: any) {
    console.error('Error en send-email-notification:', e)
    return new Response(JSON.stringify({ ok: false, error: e.message || 'Error interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
