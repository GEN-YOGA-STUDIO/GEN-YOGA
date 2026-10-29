# ==============================================================================
# scripts/deploy_scheduled_nov1.ps1
# Respaldo local de seguridad: Subida automática de CERT a PRO el 1 de Noviembre
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
Write-Log "Iniciando verificación local programada (CERT -> PRO)..."

try {
    # 1. Obtener versión esperada de certificación
    $certUrl = "https://gen-yoga-studio.github.io/GEN-YOGA-CERT/cert.json"
    $certJson = Invoke-RestMethod -Uri $certUrl -UseBasicParsing -TimeoutSec 15
    $targetVersion = $certJson.version
    Write-Log "Versión actual en Certificación ($certUrl): $targetVersion"

    if (-not $targetVersion) {
        # Fallback a package.json si no responde cert.json
        $pkg = Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
        $targetVersion = $pkg.version
        Write-Log "Fallback a package.json: versión $targetVersion"
    }

    # 2. Consultar versión servida actualmente en producción (genyoga.studio)
    $proUrl = "https://genyoga.studio/"
    $proHtml = (Invoke-WebRequest -Uri $proUrl -UseBasicParsing -TimeoutSec 15).Content
    
    # Comprobar si la versión de cert ya está en producción
    $alreadyInProd = $proHtml -match [regex]::Escape("v$targetVersion") -or $proHtml -match [regex]::Escape("'$targetVersion'") -or $proHtml -match [regex]::Escape("`"$targetVersion`"")

    if ($alreadyInProd) {
        Write-Log "✅ ¡Producción (genyoga.studio) ya está actualizada con la versión $targetVersion de CERT!"
        Write-Log "No es necesario relanzar el despliegue."
    } else {
        Write-Log "⏳ Producción no muestra aún la versión $targetVersion."
        Write-Log "Lanzando el workflow de despliegue a producción via GitHub Actions..."
        
        Set-Location $projectRoot
        $output = gh workflow run deploy-pages.yml --ref main -f force_deploy=true 2>&1
        Write-Log "Resultado del comando gh workflow run: $output"
        Write-Log "✅ Orden de despliegue enviada a GitHub Actions."
    }
} catch {
    Write-Log "❌ Error en el proceso de verificación: $_"
}

Write-Log "Fin del chequeo programado."
