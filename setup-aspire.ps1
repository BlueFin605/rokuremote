# Aspire Setup Script for RokuRemote
# Run this script to install required dependencies for local development

Write-Host "================================" -ForegroundColor Cyan
Write-Host "RokuRemote - Aspire Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptRoot

# Check .NET version
Write-Host "Checking .NET SDK version..." -ForegroundColor Yellow
$dotnetVersion = dotnet --version 2>$null
if (-not $dotnetVersion) {
    Write-Host "X .NET SDK not found. Install from https://dotnet.microsoft.com/download" -ForegroundColor Red
    exit 1
}
Write-Host "  .NET SDK: $dotnetVersion" -ForegroundColor Green

$dotnetMajor = [int]($dotnetVersion.Split('.')[0])
if ($dotnetMajor -lt 10) {
    Write-Host "X .NET 10 SDK or later is required for this repo. Install from https://dotnet.microsoft.com/download" -ForegroundColor Red
    exit 1
}
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

# Ensure Aspire CLI is available (required for local orchestration with newer SDKs)
Write-Host "Checking Aspire CLI..." -ForegroundColor Yellow
$env:Path = "$env:USERPROFILE\.dotnet\tools;" + $env:Path
$aspireCli = Get-Command aspire -ErrorAction SilentlyContinue
if (-not $aspireCli) {
    dotnet tool install -g aspire.cli
    if ($LASTEXITCODE -ne 0) {
        Write-Host "X Failed to install Aspire CLI" -ForegroundColor Red
        exit 1
    }
    $env:Path = "$env:USERPROFILE\.dotnet\tools;" + $env:Path
}
Write-Host "  Aspire CLI ready" -ForegroundColor Green
Write-Host ""

# Trust HTTPS development certificates (needed for Aspire dashboard)
# This may display a Windows UAC prompt - click Yes to allow.
Write-Host "Trusting HTTPS development certificates..." -ForegroundColor Yellow
$certCheck = dotnet dev-certs https --check --trust 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Certificate not yet trusted. A Windows security prompt may appear." -ForegroundColor Gray
    Write-Host "  Click Yes on the UAC prompt to trust the certificate." -ForegroundColor Gray
    aspire certs trust --non-interactive
    if ($LASTEXITCODE -ne 0) {
        Write-Host "! Certificate trust failed - Aspire may prompt during startup." -ForegroundColor Yellow
        Write-Host "  You can also run: dotnet dev-certs https --trust" -ForegroundColor Gray
    } else {
        Write-Host "  Certificates trusted" -ForegroundColor Green
    }
} else {
    Write-Host "  Certificates already trusted" -ForegroundColor Green
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
$cmakeCmd = Get-Command cmake -ErrorAction SilentlyContinue
if (-not $cmakeCmd) {
    Write-Host "X CMake not found. Install CMake 3.20+ from https://cmake.org/download/" -ForegroundColor Red
    exit 1
}

$cmakeVersion = cmake --version | Select-Object -First 1
Write-Host "  $cmakeVersion" -ForegroundColor Green
Write-Host ""

# Build the C++ proxy
Write-Host "Building C++ proxy..." -ForegroundColor Yellow
Push-Location proxy

$cmakeConfigureArgs = @('-S', '.', '-B', 'build', '--fresh', '-DUSE_ZLIB=OFF')

# Prefer Visual Studio generator when available because it does not require
# running inside a Developer Command Prompt.
$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsInstallPath = $null
$vsGenerator = $null
if (Test-Path $vswherePath) {
    $vsInstallPath = & $vswherePath -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    $vsMajorVersion = & $vswherePath -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property catalog_productLineVersion 2>$null

    if ($vsMajorVersion -eq '2026') {
        $vsGenerator = 'Visual Studio 18 2026'
    } elseif ($vsMajorVersion -eq '2022') {
        $vsGenerator = 'Visual Studio 17 2022'
    }
}

if ($vsInstallPath -and $vsGenerator) {
    Write-Host "  Using $vsGenerator generator" -ForegroundColor Gray
    $cmakeConfigureArgs += @('-G', $vsGenerator, '-A', 'x64')
} elseif (Get-Command ninja -ErrorAction SilentlyContinue) {
    Write-Host "  Using Ninja generator" -ForegroundColor Gray
    $cmakeConfigureArgs += @('-G', 'Ninja')
} elseif (Get-Command nmake -ErrorAction SilentlyContinue) {
    Write-Host "  Using NMake generator" -ForegroundColor Gray
    $cmakeConfigureArgs += @('-G', 'NMake Makefiles')
} else {
    Write-Host "X No supported C++ build toolchain found." -ForegroundColor Red
    Write-Host "  Install Visual Studio Build Tools with 'Desktop development with C++' workload." -ForegroundColor Red
    Pop-Location
    exit 1
}

cmake @cmakeConfigureArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "X CMake configure failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
cmake --build build
$buildResult = $LASTEXITCODE

if ($buildResult -eq 0) {
    # With multi-config generators (e.g. Visual Studio) the exe lands in a
    # configuration subdirectory (build/Debug/roku-proxy.exe).  Copy it to
    # the root of the build directory so that the Aspire AppHost can find it
    # at the path it expects (../../proxy/build/roku-proxy.exe).
    $builtExe = Get-ChildItem "build" -Recurse -Filter "roku-proxy.exe" |
        Where-Object { $_.DirectoryName -notlike "*CMakeFiles*" } |
        Select-Object -First 1
    if ($builtExe -and ($builtExe.DirectoryName -ne (Resolve-Path "build").Path)) {
        Copy-Item $builtExe.FullName "build\roku-proxy.exe" -Force
        Write-Host "  Copied $($builtExe.FullName) -> build\roku-proxy.exe" -ForegroundColor Gray
    }
    Pop-Location
    Write-Host "  Proxy built successfully" -ForegroundColor Green
} else {
    Pop-Location
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

Pop-Location
