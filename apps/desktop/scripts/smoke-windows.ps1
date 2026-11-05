# Real packaged-Windows runtime smoke check (not a CS2/GOTV end-to-end test).
# Launches the unpacked Electron binary created by the portable builder.
# Checks HTTP/JSON rendering, clean GUI shutdown, port release and restart.
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot '..\..\..\dist\win-unpacked\AnoCore Broadcast.exe'
$exe = [IO.Path]::GetFullPath($exe)
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "Packaged desktop executable not found"
}

function Assert-PortsClosed {
    foreach ($port in @(3008, 3009)) {
        $tcp = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        if ($tcp.Count -ne 0) {
            throw "Port $port is still listening (desktop already running or leaked listener)"
        }
    }
}

function Wait-For-HealthyHud([System.Diagnostics.Process]$appProcess) {
    $deadline = [DateTime]::UtcNow.AddSeconds(50)
    $lastFailure = 'HTTP response not yet available'
    while ([DateTime]::UtcNow -lt $deadline) {
        $appProcess.Refresh()
        if ($appProcess.HasExited) {
            throw "Packaged desktop exited before HUD became ready (exit $($appProcess.ExitCode))"
        }
        try {
            $response = Invoke-WebRequest 'http://127.0.0.1:3009/' -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ne 200 -or
                $response.Content -notmatch 'id="radar-preview"' -or
                $response.Content -notmatch 'id="ct-score"') {
                throw "Unexpected packaged HUD HTML"
            }
            $result = Invoke-RestMethod 'http://127.0.0.1:3009/api/state' -TimeoutSec 3
            if ($result.status -ne 'live' -or $result.demo -ne $true -or
                @($result.players).Count -ne 10 -or
                $result.radar.kind -ne 'synthetic' -or
                @($result.radar.markers).Count -ne 10) {
                throw "Packaged HUD state missing expected synthetic 5v5 data"
            }
            $raw = $result | ConvertTo-Json -Depth 12 -Compress
            if ($raw -match '"auth"|"steamid"|"position"') {
                throw 'Public packaged demo state leaked a private field'
            }
            Write-Host "Packaged HUD healthy: 10 synthetic players, 10 radar markers, sanitized JSON"
            return
        } catch {
            $lastFailure = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 450
    }
    throw "Packaged HUD did not become ready within 50 seconds: $lastFailure"
}

function Stop-DesktopGracefully([System.Diagnostics.Process]$appProcess) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    $appProcess.Refresh()
    while (-not $appProcess.HasExited -and $appProcess.MainWindowHandle -eq [IntPtr]::Zero -and
           [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $appProcess.Refresh()
    }
    if ($appProcess.HasExited) {
        throw "Desktop crashed before GUI close (exit $($appProcess.ExitCode))"
    }
    if (-not $appProcess.CloseMainWindow()) {
        throw 'Unable to request normal close of packaged Electron main window'
    }
    if (-not $appProcess.WaitForExit(25000)) {
        throw 'Desktop did not exit normally within 25 seconds'
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    do {
        $open = @(Get-NetTCPConnection -State Listen -LocalPort 3008,3009 -ErrorAction SilentlyContinue)
        if ($open.Count -eq 0) {
            Write-Host 'Normal GUI close released both local ports'
            return
        }
        Start-Sleep -Milliseconds 400
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Packaged desktop exited without releasing both local ports'
}

Assert-PortsClosed
for ($iteration = 1; $iteration -le 2; $iteration++) {
    Write-Host "Windows packaged-desktop smoke attempt $iteration of 2"
    $appProcess = Start-Process -FilePath $exe -PassThru
    try {
        Wait-For-HealthyHud $appProcess
        Stop-DesktopGracefully $appProcess
    } finally {
        $appProcess.Refresh()
        if (-not $appProcess.HasExited) {
            # Emergency cleanup is not a passing result, see assertions above.
            Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
        }
        $appProcess.Dispose()
    }
}
Write-Host 'Packaged Windows desktop start / HUD / close / restart smoke test passed'
