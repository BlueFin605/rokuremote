# Start Aspire for RokuRemote local development
# This script sets required environment variables and starts the Aspire AppHost

Write-Host "Starting RokuRemote Aspire..." -ForegroundColor Cyan
Write-Host ""

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptRoot

# Check the proxy is built
if (-not (Test-Path "proxy/build")) {
    Write-Host "X Proxy not built. Run ./setup-aspire.ps1 first." -ForegroundColor Red
    exit 1
}

# Set environment variables for Aspire
$env:ASPIRE_ALLOW_UNSECURED_TRANSPORT = "true"
$env:ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL = "http://localhost:4317"
$env:ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL = "http://localhost:4318"
# Compatibility aliases for older Aspire dashboard env var naming
$env:DOTNET_DASHBOARD_OTLP_ENDPOINT_URL = $env:ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL
$env:DOTNET_DASHBOARD_OTLP_HTTP_ENDPOINT_URL = $env:ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL
$env:ASPNETCORE_URLS = "http://localhost:15888"

Write-Host "Starting Aspire AppHost..." -ForegroundColor Yellow
Write-Host "This will start:" -ForegroundColor Gray
Write-Host "  - Mock Roku server on port 8060" -ForegroundColor Gray
Write-Host "  - C++ proxy on port 8080" -ForegroundColor Gray
Write-Host "  - Angular dev server on port 4200" -ForegroundColor Gray
Write-Host ""

# Start Aspire
$env:Path = "$env:USERPROFILE\.dotnet\tools;" + $env:Path
$aspireCli = Get-Command aspire -ErrorAction SilentlyContinue
$appHostProject = Join-Path $scriptRoot "aspire\RokuRemote.AppHost\RokuRemote.AppHost.csproj"

if ($aspireCli) {
    aspire run --apphost $appHostProject --non-interactive
} else {
    Write-Host "Aspire CLI not found, falling back to dotnet run..." -ForegroundColor Yellow
    dotnet run --project $appHostProject
}

Pop-Location
