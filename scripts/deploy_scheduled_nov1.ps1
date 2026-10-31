# ==============================================================================
# scripts/deploy_scheduled_nov1.ps1
# Respaldo local de seguridad: Subida automática de versión 18.1 a PRO el 1 de Noviembre
# ==============================================================================

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$scratchDir = Join-Path $projectRoot "scratch"
if (-not (Test-Path $scratchDir)) {
    New-Item -ItemType Directory -Path $scratchDir -Force | Out-Null
}
$logPath = Join-Path $scratchDir "deploy_scheduled_nov1.log"

function Write-Log($msg) {
    $now = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$now] $msg"
    Write-Host $line
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

Write-Log "------------------------------------------------------------"
Write-Log "Iniciando verificación local programada (v18.1 -> PRO)..."

try {
    # 1. Versión objetivo: 18.1 (línea base validada previa a los cambios de la 18.2)
    $targetVersion = "18.1"
    $targetRef = "v18.1-baseline"
    Write-Log "Versión objetivo programada para esta noche: $targetVersion (Ref: $targetRef)"

    # 2. Consultar versión servida actualmente en producción (genyoga.studio)
    $proUrl = "https://genyoga.studio/"
    $proHtml = (Invoke-WebRequest -Uri $proUrl -UseBasicParsing -TimeoutSec 15).Content
    
    # Comprobar si la versión 18.1 ya está en producción
    $alreadyInProd = $proHtml -match [regex]::Escape("v$targetVersion") -or $proHtml -match [regex]::Escape("'$targetVersion'") -or $proHtml -match [regex]::Escape("`"$targetVersion`"")

    if ($alreadyInProd) {
        Write-Log "✅ ¡Producción (genyoga.studio) ya está actualizada con la versión $targetVersion!"
        Write-Log "No es necesario relanzar el despliegue."
    } else {
        Write-Log "⏳ Producción no muestra aún la versión $targetVersion."
        Write-Log "Lanzando el workflow de despliegue a producción via GitHub Actions para $targetRef..."
        
        Set-Location $projectRoot
        $output = gh workflow run deploy-pages.yml --ref main -f version=$targetRef -f force_deploy=true 2>&1
        Write-Log "Resultado del comando gh workflow run: $output"
        Write-Log "✅ Orden de despliegue enviada a GitHub Actions con versión $targetRef."
    }
} catch {
    Write-Log "❌ Error en el proceso de verificación: $_"
}

Write-Log "Fin del chequeo programado."
