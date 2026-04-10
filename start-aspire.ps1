# Start Aspire for RokuRemote local development
# This script sets required environment variables and starts the Aspire AppHost

Write-Host "Starting RokuRemote Aspire..." -ForegroundColor Cyan
Write-Host ""

# Check the proxy is built
if (-not (Test-Path "proxy/build")) {
    Write-Host "X Proxy not built. Run ./setup-aspire.ps1 first." -ForegroundColor Red
    exit 1
}

# Set environment variables for Aspire
$env:ASPIRE_ALLOW_UNSECURED_TRANSPORT = "true"
$env:DOTNET_DASHBOARD_OTLP_ENDPOINT_URL = "http://localhost:4317"
$env:DOTNET_DASHBOARD_OTLP_HTTP_ENDPOINT_URL = "http://localhost:4318"
$env:ASPNETCORE_URLS = "http://localhost:15888"

Write-Host "Starting Aspire AppHost..." -ForegroundColor Yellow
Write-Host "This will start:" -ForegroundColor Gray
Write-Host "  - Mock Roku server on port 8060" -ForegroundColor Gray
Write-Host "  - C++ proxy on port 8080" -ForegroundColor Gray
Write-Host "  - Angular dev server on port 4200" -ForegroundColor Gray
Write-Host ""

# Start Aspire
dotnet run --project aspire\RokuRemote.AppHost\RokuRemote.AppHost.csproj
