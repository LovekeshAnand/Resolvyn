<#
  Run ONLY the backend and open a public ngrok address for it, so the hosted UI (Vercel) can call it.

    .\start-public.ps1              start the backend + an ngrok tunnel, print the address and a ready-to-open link
    .\start-public.ps1 -Fresh       wipe the local SQLite database first (seeds are re-created)

  Optional, in backend\.env (or as environment variables):
    NGROK_DOMAIN=your-name.ngrok-free.app   a free static domain from the ngrok dashboard (Domains). With one, the address never
                                            changes and you set NEXT_PUBLIC_API_BASE_URL=https://<domain> once on Vercel.
    VERCEL_APP_URL=https://resolvyn.vercel.app   makes the script print (and copy) a link that points the site at this backend.

  Without a static domain the address changes every run: open the printed link, or paste the address into the
  "Connect to backend" box the site shows when it cannot reach the backend.
#>
param([switch]$Fresh)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
function Say($m) { Write-Host "[resolvyn] $m" -ForegroundColor Cyan }

function EnvValue($name) {
    $v = [Environment]::GetEnvironmentVariable($name)
    if ($v) { return $v.Trim() }
    $f = Join-Path $backend ".env"
    if (Test-Path $f) {
        $line = Get-Content $f | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
        if ($line) { return ($line -replace "^\s*$name\s*=", "").Trim().Trim('"') }
    }
    return $null
}

$py = Join-Path $backend ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "backend\.venv is missing - run .\start.ps1 once first." }
if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) { throw "ngrok not found. Install it and run: ngrok config add-authtoken <token>" }
if ($Fresh) { Remove-Item (Join-Path $backend "data\resolvyn.db*") -Force -ErrorAction SilentlyContinue; Say "database wiped" }

& (Join-Path $root "stop.ps1") -Quiet
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# ── the public address of the backend ────────────────────────────────────────
$domain = EnvValue "NGROK_DOMAIN"
$ngrokArgs = @("http", "8000")
if ($domain) { $ngrokArgs += "--domain=$domain" }
Say "opening an ngrok tunnel to the backend (port 8000)..."
Start-Process -FilePath "ngrok" -ArgumentList $ngrokArgs -WindowStyle Minimized
$publicUrl = $null
for ($i = 0; $i -lt 25 -and -not $publicUrl; $i++) {
    Start-Sleep -Seconds 1
    try { $publicUrl = (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels -TimeoutSec 2).tunnels | Where-Object { $_.public_url -like "https*" } | Select-Object -First 1 -ExpandProperty public_url } catch { }
}
if (-not $publicUrl) { throw "Could not read the ngrok address. Is your authtoken set (ngrok config add-authtoken <token>) and is $domain yours?" }
$env:PUBLIC_BASE_URL = $publicUrl   # the backend uses this for links that must work from outside (telephony webhooks)

# ── the backend ──────────────────────────────────────────────────────────────
Say "starting the backend (model load takes about 10 s)..."
Start-Process -FilePath $py -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" -WorkingDirectory $backend -WindowStyle Minimized
$ready = $false
for ($i = 0; $i -lt 90 -and -not $ready; $i++) {
    Start-Sleep -Seconds 1
    try { $h = Invoke-RestMethod http://localhost:8000/health -TimeoutSec 2; if ($h.llm_ready) { $ready = $true } } catch { }
}
if (-not $ready) { Write-Warning "The backend did not report the model ready in 90 s; it may still be loading." }
$through = $null
try { $through = (Invoke-WebRequest "$publicUrl/health" -Headers @{ "ngrok-skip-browser-warning" = "1" } -UseBasicParsing -TimeoutSec 8).StatusCode } catch { }

Write-Host ""
Write-Host "  Backend (public) : $publicUrl" -ForegroundColor Green
if ($through -eq 200) { Write-Host "  Reachable through the tunnel: yes" -ForegroundColor Green } else { Write-Warning "The tunnel did not answer /health yet." }
$site = EnvValue "VERCEL_APP_URL"
if ($site) {
    $link = ($site.TrimEnd("/")) + "/talk?api=" + $publicUrl
    Write-Host "  Open this link   : $link" -ForegroundColor Yellow
    try { Set-Clipboard -Value $link; Write-Host "                     (copied to the clipboard)" -ForegroundColor DarkGray } catch { }
} else {
    Write-Host "  Paste that address into the site's 'Connect to backend' box, or open  <your-site>/talk?api=$publicUrl" -ForegroundColor Yellow
}
Write-Host "  Stop everything with .\stop.ps1   (and close the ngrok window)"
