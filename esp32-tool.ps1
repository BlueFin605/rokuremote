param(
    [Parameter(Position=0)]
    [ValidateSet("flash", "monitor", "flash-monitor")]
    [string]$Command = "flash-monitor",

    [string]$Port = "COM4",
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

switch ($Command) {
    "flash"         { Flash }
    "monitor"       { Monitor }
    "flash-monitor" { Flash; Start-Sleep -Seconds 2; Monitor }
}
