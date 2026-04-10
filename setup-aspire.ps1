# Aspire Setup Script for RokuRemote
# Run this script to install required dependencies for local development

Write-Host "================================" -ForegroundColor Cyan
Write-Host "RokuRemote - Aspire Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check .NET version
Write-Host "Checking .NET SDK version..." -ForegroundColor Yellow
$dotnetVersion = dotnet --version 2>$null
if (-not $dotnetVersion) {
    Write-Host "X .NET SDK not found. Install from https://dotnet.microsoft.com/download" -ForegroundColor Red
    exit 1
}
Write-Host "  .NET SDK: $dotnetVersion" -ForegroundColor Green
Write-Host ""

# Install Aspire workload
Write-Host "Installing .NET Aspire workload..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray
dotnet workload update
dotnet workload install aspire

if ($LASTEXITCODE -eq 0) {
    Write-Host "  Aspire workload installed" -ForegroundColor Green
} else {
    Write-Host "X Failed to install Aspire workload" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if ($nodeVersion) {
    Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "X Node.js not found. Install Node.js 20 or later." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check CMake
Write-Host "Checking CMake..." -ForegroundColor Yellow
$cmakeVersion = cmake --version 2>$null | Select-Object -First 1
if ($cmakeVersion) {
    Write-Host "  $cmakeVersion" -ForegroundColor Green
} else {
    Write-Host "X CMake not found. Install CMake 3.20+ from https://cmake.org/download/" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Build the C++ proxy
Write-Host "Building C++ proxy..." -ForegroundColor Yellow
Push-Location proxy
cmake -B build
if ($LASTEXITCODE -ne 0) {
    Write-Host "X CMake configure failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
cmake --build build
$buildResult = $LASTEXITCODE
Pop-Location

if ($buildResult -eq 0) {
    Write-Host "  Proxy built successfully" -ForegroundColor Green
} else {
    Write-Host "X Proxy build failed" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Build the AppHost project
Write-Host "Building Aspire AppHost project..." -ForegroundColor Yellow
Push-Location aspire/RokuRemote.AppHost
dotnet build
$buildResult = $LASTEXITCODE
Pop-Location

if ($buildResult -eq 0) {
    Write-Host "  AppHost built successfully" -ForegroundColor Green
} else {
    Write-Host "X AppHost build failed" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Install app dependencies
if (Test-Path "app/package.json") {
    Write-Host "Installing Angular app dependencies..." -ForegroundColor Yellow
    Push-Location app
    npm install
    Pop-Location
    Write-Host "  App dependencies installed" -ForegroundColor Green
    Write-Host ""
}

# Install mock dependencies
if (Test-Path "mock/package.json") {
    Write-Host "Installing mock server dependencies..." -ForegroundColor Yellow
    Push-Location mock
    npm install
    Pop-Location
    Write-Host "  Mock dependencies installed" -ForegroundColor Green
    Write-Host ""
}

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Run: " -NoNewline -ForegroundColor White
Write-Host "./start-aspire.ps1" -ForegroundColor Cyan
Write-Host "2. Open the Aspire Dashboard URL shown in the terminal" -ForegroundColor White
Write-Host "3. Access the app at http://localhost:4200" -ForegroundColor White
Write-Host ""
