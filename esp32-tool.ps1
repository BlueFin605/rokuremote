param(
    [Parameter(Position=0)]
    [ValidateSet("flash", "monitor", "flash-monitor")]
    [string]$Command = "flash-monitor",

    [string]$Port = "COM3",
    [string]$FirmwarePath = "$env:USERPROFILE\Downloads\roku-proxy-esp32"
)

$esptool = "$env:LOCALAPPDATA\Arduino15\packages\esp32\tools\esptool_py\5.1.0\esptool.exe"

function Flash {
    $bootloader = Join-Path $FirmwarePath "bootloader\bootloader.bin"
    $partition  = Join-Path $FirmwarePath "partition_table\partition-table.bin"
    $app        = Join-Path $FirmwarePath "roku-proxy-esp32.bin"

    foreach ($f in @($bootloader, $partition, $app)) {
        if (-not (Test-Path $f)) {
            Write-Host "Missing: $f" -ForegroundColor Red
            exit 1
        }
    }

    Write-Host "Flashing to $Port..." -ForegroundColor Cyan
    & $esptool --chip esp32s3 --port $Port --baud 460800 write-flash -z `
        0x0 $bootloader `
        0x8000 $partition `
        0x10000 $app

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Flash failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "Flash complete." -ForegroundColor Green
}

function Monitor {
    Write-Host "Opening serial monitor on $Port at 115200 baud. Press Ctrl+C to exit." -ForegroundColor Cyan

    $serial = New-Object System.IO.Ports.SerialPort $Port, 115200
    $serial.ReadTimeout = 500
    $serial.DtrEnable = $true
    $serial.Open()

    try {
        while ($true) {
            try {
                $line = $serial.ReadLine()
                Write-Host $line
            } catch [System.TimeoutException] {
                # No data, keep waiting
            }

            # Check for user input to send to ESP32
            if ([Console]::KeyAvailable) {
                $key = [Console]::ReadLine()
                $serial.WriteLine($key)
            }
        }
    } finally {
        $serial.Close()
        Write-Host "Serial port closed." -ForegroundColor Yellow
    }
}

switch ($Command) {
    "flash"         { Flash }
    "monitor"       { Monitor }
    "flash-monitor" { Flash; Start-Sleep -Seconds 2; Monitor }
}
