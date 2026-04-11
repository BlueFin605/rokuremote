param(
    [Parameter(Position=0)]
    [ValidateSet("flash", "monitor", "flash-monitor", "flash-url", "flash-monitor-url", "ports", "full-reset")]
    [string]$Command = "flash-monitor",

    [string]$Port = "COM4",
    [ValidateSet("esp32", "esp32s3")]
    [string]$Chip = "esp32s3",
    [string]$FirmwareFlavor = "",
    [string]$FirmwarePath = "$env:USERPROFILE\Downloads\roku-proxy-esp32",
    [string]$FirmwareUrlBase = "",
    [string]$BootloaderOffset = "",
    [string]$PartitionOffset = "0x8000",
    [string]$AppOffset = "0x10000",
    [string]$BootloaderRelativePath = "bootloader/bootloader.bin",
    [string]$PartitionRelativePath = "partition_table/partition-table.bin",
    [string]$AppRelativePath = "roku-proxy-esp32.bin",
    [switch]$AutoSelectPort,
    [switch]$Force
)

$esptool = "$env:LOCALAPPDATA\Arduino15\packages\esp32\tools\esptool_py\5.1.0\esptool.exe"

function Get-EffectiveSourcePath {
    param(
        [Parameter(Mandatory=$true)]
        [string]$BasePath
    )

    if ([string]::IsNullOrWhiteSpace($FirmwareFlavor)) {
        return $BasePath
    }

    $candidate = Join-Path $BasePath $FirmwareFlavor
    if (Test-Path $candidate) {
        return $candidate
    }

    Write-Host "Firmware flavor '$FirmwareFlavor' requested, but folder not found: $candidate" -ForegroundColor Red
    exit 1
}

function Resolve-TargetPort {
    $availablePorts = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)

    if ($availablePorts -contains $Port) {
        return $Port
    }

    if ($AutoSelectPort -and $availablePorts.Count -eq 1) {
        $selected = $availablePorts[0]
        Write-Host "Requested port $Port not available. Auto-selected $selected." -ForegroundColor Yellow
        return $selected
    }

    Write-Host "Selected port $Port is not currently available." -ForegroundColor Red
    if ($availablePorts.Count -gt 0) {
        Write-Host "Available ports: $($availablePorts -join ', ')" -ForegroundColor Yellow
    } else {
        Write-Host "No serial ports detected." -ForegroundColor Yellow
    }
    exit 1
}

function Show-Ports {
    $ports = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)
    if ($ports.Count -eq 0) {
        Write-Host "No serial ports detected." -ForegroundColor Yellow
        return
    }

    Write-Host "Available serial ports:" -ForegroundColor Cyan
    foreach ($p in $ports) {
        Write-Host "  $p"
    }
}

function Download-FirmwareFromUrl {
    param(
        [Parameter(Mandatory=$true)]
        [string]$UrlBase
    )

    $baseUrl = $UrlBase.TrimEnd('/')
    if (-not [string]::IsNullOrWhiteSpace($FirmwareFlavor)) {
        # Only append the flavor when the caller passed a parent URL.
        # This avoids ending up with .../esp32/esp32 when flavor is already included.
        if (-not $baseUrl.EndsWith("/$FirmwareFlavor", [System.StringComparison]::OrdinalIgnoreCase)) {
            $baseUrl = "$baseUrl/$FirmwareFlavor"
        }
    }

    $downloadRoot = Join-Path $env:TEMP ("roku-proxy-esp32-" + [Guid]::NewGuid().ToString("N"))
    $downloadBase = if ([string]::IsNullOrWhiteSpace($FirmwareFlavor)) {
        $downloadRoot
    } else {
        Join-Path $downloadRoot $FirmwareFlavor
    }

    New-Item -ItemType Directory -Path $downloadBase -Force | Out-Null

    $files = @(
        @{ Relative = $BootloaderRelativePath; Local = Join-Path $downloadBase $BootloaderRelativePath },
        @{ Relative = $PartitionRelativePath; Local = Join-Path $downloadBase $PartitionRelativePath },
        @{ Relative = $AppRelativePath; Local = Join-Path $downloadBase $AppRelativePath }
    )

    Write-Host "Downloading firmware from $baseUrl" -ForegroundColor Cyan
    foreach ($file in $files) {
        $url = "$baseUrl/$($file.Relative)"
        Write-Host "  $url"
        try {
            $targetDir = Split-Path $file.Local -Parent
            if (-not (Test-Path $targetDir)) {
                New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
            }
            Invoke-WebRequest -Uri $url -OutFile $file.Local
        } catch {
            Write-Host "Failed to download: $url" -ForegroundColor Red
            throw
        }
    }

    Write-Host "Download complete: $downloadRoot" -ForegroundColor Green
    return $downloadRoot
}

function Flash {
    param(
        [string]$SourcePath = $FirmwarePath
    )

    $effectiveSource = Get-EffectiveSourcePath -BasePath $SourcePath

    $bootloader = Join-Path $effectiveSource $BootloaderRelativePath
    $partition  = Join-Path $effectiveSource $PartitionRelativePath
    $app        = Join-Path $effectiveSource $AppRelativePath

    foreach ($f in @($bootloader, $partition, $app)) {
        if (-not (Test-Path $f)) {
            Write-Host "Missing: $f" -ForegroundColor Red
            exit 1
        }
    }

    $targetPort = Resolve-TargetPort

    $bootloaderOffset = if ([string]::IsNullOrWhiteSpace($BootloaderOffset)) {
        if ($Chip -eq "esp32") { "0x1000" } else { "0x0" }
    } else {
        $BootloaderOffset
    }

    Write-Host "Flashing $Chip to $targetPort..." -ForegroundColor Cyan
    & $esptool --chip $Chip --port $targetPort --baud 460800 write-flash -z `
        $bootloaderOffset $bootloader `
        $PartitionOffset $partition `
        $AppOffset $app

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Flash failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "Flash complete." -ForegroundColor Green
}

function Monitor {
    Write-Host "Opening serial monitor on $Port at 115200 baud. Press Ctrl+C to exit." -ForegroundColor Cyan
    Write-Host "(Auto-reconnects on USB disconnect)" -ForegroundColor DarkGray

    try {
        while ($true) {
            # Wait for port to be available
            while (-not [System.IO.Ports.SerialPort]::GetPortNames().Contains($Port)) {
                Start-Sleep -Milliseconds 500
            }

            $serial = New-Object System.IO.Ports.SerialPort $Port, 115200
            $serial.ReadTimeout = 100
            $serial.DtrEnable = $false
            $serial.RtsEnable = $false

            try {
                $serial.Open()
                Write-Host "--- Connected to $Port ---" -ForegroundColor Green

                while ($serial.IsOpen) {
                    # Read any available data from ESP32
                    try {
                        $available = $serial.BytesToRead
                        if ($available -gt 0) {
                            $buf = $serial.ReadExisting()
                            Write-Host -NoNewline $buf
                        }
                    } catch [System.TimeoutException] {
                        # No data
                    } catch {
                        # Port disconnected
                        break
                    }

                    # Check for user input to send to ESP32
                    if ([Console]::KeyAvailable) {
                        $key = [Console]::ReadKey($true)
                        if ($key.Key -eq 'Enter') {
                            $serial.Write("`r`n")
                            Write-Host ""
                        } else {
                            $serial.Write($key.KeyChar.ToString())
                        }
                    }

                    Start-Sleep -Milliseconds 10
                }
            } catch {
                # Connection lost or failed to open
            } finally {
                if ($serial.IsOpen) { $serial.Close() }
                $serial.Dispose()
            }

            Write-Host "`n--- Disconnected, waiting for $Port ---" -ForegroundColor Yellow
            Start-Sleep -Seconds 1
        }
    } finally {
        Write-Host "Serial monitor closed." -ForegroundColor Yellow
    }
}

function FullReset {
    $targetPort = Resolve-TargetPort

    if (-not $Force) {
        Write-Host "WARNING: full-reset will erase all flash contents on $targetPort." -ForegroundColor Yellow
        Write-Host "This clears firmware, credentials, and stored settings." -ForegroundColor Yellow
        $confirmation = Read-Host "Type ERASE to continue"
        if ($confirmation -ne "ERASE") {
            Write-Host "Full reset canceled." -ForegroundColor Yellow
            return
        }
    }

    $chipCandidates = @($Chip)
    if (-not $PSBoundParameters.ContainsKey("Chip")) {
        if ($Chip -eq "esp32s3") {
            $chipCandidates += "esp32"
        } else {
            $chipCandidates += "esp32s3"
        }
    }

    $resetSucceeded = $false
    foreach ($candidateChip in $chipCandidates) {
        if ($candidateChip -ne $Chip) {
            Write-Host "Chip auto-fallback: retrying full reset with '$candidateChip'." -ForegroundColor Yellow
        }

        Write-Host "Erasing full flash on $targetPort (chip: $candidateChip)..." -ForegroundColor Cyan
        & $esptool --chip $candidateChip --port $targetPort erase-flash

        if ($LASTEXITCODE -eq 0) {
            $resetSucceeded = $true
            break
        }
    }

    if (-not $resetSucceeded) {
        Write-Host "Full reset failed." -ForegroundColor Red
        exit 1
    }

    Write-Host "Full reset complete. Reflash firmware before normal operation." -ForegroundColor Green
}

switch ($Command) {
    "flash" {
        Flash
    }
    "ports" {
        Show-Ports
    }
    "monitor" {
        Monitor
    }
    "flash-monitor" {
        Flash
        Start-Sleep -Seconds 2
        Monitor
    }
    "flash-url" {
        if ([string]::IsNullOrWhiteSpace($FirmwareUrlBase)) {
            Write-Host "FirmwareUrlBase is required for flash-url" -ForegroundColor Red
            exit 1
        }

        $downloadPath = Download-FirmwareFromUrl -UrlBase $FirmwareUrlBase
        try {
            Flash -SourcePath $downloadPath
        } finally {
            Remove-Item -Recurse -Force $downloadPath -ErrorAction SilentlyContinue
        }
    }
    "flash-monitor-url" {
        if ([string]::IsNullOrWhiteSpace($FirmwareUrlBase)) {
            Write-Host "FirmwareUrlBase is required for flash-monitor-url" -ForegroundColor Red
            exit 1
        }

        $downloadPath = Download-FirmwareFromUrl -UrlBase $FirmwareUrlBase
        try {
            Flash -SourcePath $downloadPath
        } finally {
            Remove-Item -Recurse -Force $downloadPath -ErrorAction SilentlyContinue
        }

        Start-Sleep -Seconds 2
        Monitor
    }
    "full-reset" {
        FullReset
    }
}
