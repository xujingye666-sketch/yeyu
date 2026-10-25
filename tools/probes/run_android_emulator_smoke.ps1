param(
    [string]$AvdName = "yeyu_vc204_api35",
    [ValidateRange(30, 300)]
    [int]$BootTimeoutSeconds = 150,
    [string]$Apk = "",
    [switch]$NativeLifecycle,
    [switch]$KeepEmulator
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$artifactRoot = Join-Path $projectRoot ".tmp\android-emulator-smoke"
$packageName = "com.yeyu.app"
$activityName = "$packageName/.MainActivity"
$emulatorStartedHere = $false
$testDataTouched = $false
$deviceSerial = ""
$actualAvdName = ""
$previousCachedAppsFreezer = ""
$cachedAppsFreezerChanged = $false
$emulatorProcess = $null
$emulatorChildren = @()
$logStamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$stdoutLog = Join-Path $artifactRoot "emulator-$logStamp-stdout.log"
$stderrLog = Join-Path $artifactRoot "emulator-$logStamp-stderr.log"
. (Join-Path $projectRoot "tools\qa\android_environment.ps1")

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & $script:adbPath -s $script:deviceSerial @Arguments
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $($Arguments -join ' ')" }
}

function Get-EmulatorDevices {
    $lines = @(& $script:adbPath devices)
    if ($LASTEXITCODE -ne 0) { throw "adb failed: devices" }
    @($lines | ForEach-Object {
        if ($_ -match '^(emulator-\d+)\s+(\S+)') {
            [pscustomobject]@{ Serial = $Matches[1]; State = $Matches[2] }
        }
    })
}

function Get-EmulatorAvdName {
    param([string]$Serial)
    $lines = @(& $script:adbPath -s $Serial emu avd name 2>$null)
    if ($LASTEXITCODE -ne 0) { return "" }
    return [string](@($lines | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne "OK" }) | Select-Object -First 1)
}

function Find-RunningAvd {
    param([string]$Name)
    $matches = @(Get-EmulatorDevices | ForEach-Object {
        $runningName = Get-EmulatorAvdName -Serial $_.Serial
        if ($runningName -ceq $Name) {
            [pscustomobject]@{ Serial = $_.Serial; AvdName = $runningName }
        }
    })
    if ($matches.Count -gt 1) { throw "Multiple running emulators match AVD '$Name': $($matches.Serial -join ', ')" }
    return $matches | Select-Object -First 1
}

function Test-EmulatorProcessAlive {
    # Windows emulator.exe may delegate to qemu; retain child handles even after the launcher exits.
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($emulatorProcess.Id)" |
        Where-Object { $_.Name -like 'qemu*' } |
        ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
    $script:emulatorChildren = @(@($script:emulatorChildren) + $children | Sort-Object Id -Unique)
    $emulatorProcess.Refresh()
    if ($script:emulatorChildren.Count) {
        return @($script:emulatorChildren | Where-Object { -not $_.HasExited }).Count -gt 0
    }
    return -not $emulatorProcess.HasExited
}

function Get-EmulatorLogTail {
    $sections = foreach ($entry in @(@('stderr', $stderrLog), @('stdout', $stdoutLog))) {
        $tail = if (Test-Path -LiteralPath $entry[1]) { Get-Content -LiteralPath $entry[1] -Tail 20 -Encoding UTF8 }
        "$($entry[0]) tail ($($entry[1])):`n$(if ($tail) { $tail -join "`n" } else { '(empty)' })"
    }
    return $sections -join "`n"
}

function Capture-Screen {
    param([string]$Name)
    $remotePath = "/sdcard/yeyu-$Name.png"
    $localPath = Join-Path $artifactRoot "$Name.png"
    $relativePath = Join-Path ".tmp\android-emulator-smoke" "$Name.png"
    Invoke-Adb shell screencap '-p' $remotePath | Out-Null
    Push-Location $projectRoot
    try { Invoke-Adb pull $remotePath $relativePath | Out-Null } finally { Pop-Location }
    Invoke-Adb shell rm $remotePath | Out-Null
    if (-not (Test-Path -LiteralPath $localPath) -or (Get-Item -LiteralPath $localPath).Length -lt 1024) {
        throw "Screenshot was not captured: $localPath"
    }
    return $localPath
}

function Get-UiHierarchy {
    $remotePath = "/sdcard/yeyu-ui.xml"
    $relativePath = ".tmp\android-emulator-smoke\ui.xml"
    $localPath = Join-Path $projectRoot $relativePath
    Invoke-Adb shell uiautomator dump $remotePath | Out-Null
    Push-Location $projectRoot
    try { Invoke-Adb pull $remotePath $relativePath | Out-Null } finally { Pop-Location }
    Invoke-Adb shell rm $remotePath | Out-Null
    return [xml](Get-Content -Raw -LiteralPath $localPath)
}

function Wait-UiNode {
    param([string]$Text = "", [string]$Class = "", [int]$TimeoutSeconds = 12)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $document = Get-UiHierarchy
        $nodes = @($document.SelectNodes('//node') | Where-Object {
            ($Text -eq "" -or $_.text -eq $Text) -and
            ($Class -eq "" -or $_.class -eq $Class) -and
            $_.enabled -eq "true" -and $_.bounds -match '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$' -and
            [int]$Matches[3] -gt [int]$Matches[1] -and [int]$Matches[4] -gt [int]$Matches[2]
        })
        $node = if ($nodes.Count) { $nodes[0] }
        if ($node) { return $node }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $deadline)
    throw "UI node not found: text='$Text' class='$Class'"
}

try {
    $androidSdk = Resolve-AndroidSdk -ProjectRoot $projectRoot -RequireAdb -RequireEmulator
    $env:JAVA_HOME = Resolve-AndroidJavaHome
    $script:adbPath = Join-Path $androidSdk "platform-tools\adb.exe"
    $emulatorPath = Join-Path $androidSdk "emulator\emulator.exe"
    New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
    Set-Content -LiteralPath $stdoutLog, $stderrLog -Value "" -Encoding UTF8
    if ($Apk) { $Apk = (Resolve-Path -LiteralPath $Apk).Path }

    $runningAvd = Find-RunningAvd -Name $AvdName
    if ($runningAvd) {
        & $script:adbPath -s $runningAvd.Serial emu kill | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Unable to stop existing AVD: $AvdName" }
        $stopDeadline = (Get-Date).AddSeconds(15)
        while (@(Get-EmulatorDevices | Where-Object Serial -eq $runningAvd.Serial).Count) {
            if ((Get-Date) -ge $stopDeadline) { throw "Existing AVD did not stop: $AvdName" }
            Start-Sleep -Milliseconds 500
        }
    }
    $runningAvd = $null
    $emulatorProcess = Start-Process -FilePath $emulatorPath -ArgumentList @('-avd', $AvdName, '-no-snapshot-load', '-no-snapshot-save', '-no-window', '-no-audio', '-no-boot-anim') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
    $emulatorStartedHere = $true
    $bootTimer = [Diagnostics.Stopwatch]::StartNew()
    $deadline = (Get-Date).AddSeconds($BootTimeoutSeconds)
    $bootValue = ''
    do {
        if (-not (Test-EmulatorProcessAlive)) { throw "模拟器进程已退出: $AvdName (launcher exit $($emulatorProcess.ExitCode))" }
        if (-not $runningAvd) { $runningAvd = Find-RunningAvd -Name $AvdName }
        if ($runningAvd) {
            $script:deviceSerial = $runningAvd.Serial
            $actualAvdName = $runningAvd.AvdName
            $bootValue = @(& $script:adbPath -s $script:deviceSerial shell getprop sys.boot_completed 2>$null) -join ''
            if ($bootValue.Trim() -eq '1') { break }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    $bootTimer.Stop()
    if (-not $script:deviceSerial -or $bootValue.Trim() -ne '1') { throw "AVD boot timed out after $BootTimeoutSeconds seconds: $AvdName" }
    Write-Host "Cold boot completed in $([math]::Round($bootTimer.Elapsed.TotalSeconds, 2)) seconds: $actualAvdName"
    if ($script:deviceSerial -notmatch '^emulator-\d+$') { throw "Refusing to clear data on non-emulator target: $script:deviceSerial" }
    $actualAvdName = Get-EmulatorAvdName -Serial $script:deviceSerial
    if ($actualAvdName -cne $AvdName) { throw "Selected emulator identity changed: expected AVD '$AvdName', got '$actualAvdName' on $script:deviceSerial" }

    $sdkLevel = @(& $script:adbPath -s $script:deviceSerial shell getprop ro.build.version.sdk) -join ''
    $windowSize = @(& $script:adbPath -s $script:deviceSerial shell wm size) -join "`n"
    if ($sdkLevel.Trim() -ne '35') { throw "Expected API 35 emulator, got API $($sdkLevel.Trim())" }
    if ($windowSize -notmatch 'Override size:\s*390x844') { throw "Expected 390x844 override, got: $windowSize" }
    if ($NativeLifecycle) {
        # Android may freeze the cached renderer while DocumentsUI is foreground, preventing CDP
        # observation of pending file callbacks. Native pause/resume is still exercised unchanged.
        $previousCachedAppsFreezer = (Invoke-Adb shell settings get global cached_apps_freezer).Trim()
        Invoke-Adb shell settings put global cached_apps_freezer disabled | Out-Null
        $cachedAppsFreezerChanged = $true
    }

    if (-not $Apk) {
        Push-Location $projectRoot
        try {
            & .\gradlew.bat :app:assembleDebug --no-daemon
            if ($LASTEXITCODE -ne 0) { throw "Debug build failed" }
        } finally { Pop-Location }
        $Apk = Join-Path $projectRoot "app\build\outputs\apk\debug\app-debug.apk"
    }
    $apkHash = (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant()
    Invoke-Adb install '-r' $Apk | Out-Null
    $testDataTouched = $true
    Invoke-Adb shell pm clear $packageName | Out-Null
    Invoke-Adb shell am start '-W' '-n' $activityName | Out-Null
    Start-Sleep -Seconds 3
    $launchScreenshot = Capture-Screen "launch"

    # Exercise a real edge-to-edge WebView modal and a real IME transition.
    $settingsOpened = $false
    for ($attempt = 0; $attempt -lt 3 -and -not $settingsOpened; $attempt++) {
        Invoke-Adb shell input tap 340 790 | Out-Null
        try {
            Wait-UiNode -Text "设置" -Class "android.view.View" -TimeoutSeconds 4 | Out-Null
            $settingsOpened = $true
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }
    if (-not $settingsOpened) { throw "Settings modal did not open" }
    $settingsScreenshot = Capture-Screen "settings-safe-bottom"
    $inputNode = Wait-UiNode -Class "android.widget.EditText"
    if ($inputNode.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') { throw "Input bounds are unavailable" }
    $inputX = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
    $inputY = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
    Invoke-Adb shell input tap $inputX $inputY | Out-Null
    Start-Sleep -Seconds 2
    $imeScreenshot = Capture-Screen "settings-ime"

    $focusReport = @(& $script:adbPath -s $script:deviceSerial shell dumpsys window) -join "`n"
    $imeReport = @(& $script:adbPath -s $script:deviceSerial shell dumpsys input_method) -join "`n"
    if ($focusReport -notmatch [regex]::Escape($activityName.Split('/')[0])) { throw "Yeyu Activity is not focused" }
    if ($imeReport -notmatch 'mInputShown=true' -or $imeReport -notmatch 'mIsInputViewShown=true') { throw "IME did not open inside the WebView" }

    # The same-origin card runtime is a platform boundary: only the real WebView can prove that a
    # packaged file-page srcdoc iframe reaches its true parent and storage without sandbox attributes.
    $appPid = (@(& $script:adbPath -s $script:deviceSerial shell pidof $packageName) -join '').Trim()
    if ($appPid -notmatch '^\d+$') { throw "Yeyu process not found; cannot probe the card frontend runtime" }
    $devtoolsSocket = "webview_devtools_remote_$appPid"
    $devtoolsSockets = @(& $script:adbPath -s $script:deviceSerial shell "cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*'")
    if ($devtoolsSockets -notcontains $devtoolsSocket) { throw "Yeyu WebView devtools socket not found: $devtoolsSocket" }
    $probePort = 9222
    Invoke-Adb forward "tcp:$probePort" "localabstract:$devtoolsSocket" | Out-Null
    try {
        Push-Location $projectRoot
        try {
            $probeArguments = @("tools\probes\android_webview_sandbox_probe.js", $probePort, $script:adbPath, $script:deviceSerial)
            if ($NativeLifecycle) { $probeArguments += '--native-lifecycle' }
            $probeOutput = & node @probeArguments 2>&1
            if ($LASTEXITCODE -ne 0) { throw "Card frontend runtime probe failed: $($probeOutput -join "`n")" }
        } finally { Pop-Location }
    } finally {
        try { & $script:adbPath -s $script:deviceSerial forward --remove "tcp:$probePort" | Out-Null } catch {}
    }
    $runtimeProbe = ($probeOutput -join "`n") | ConvertFrom-Json

    [pscustomobject]@{
        apk = $Apk
        apkSha256 = $apkHash
        coldBootSeconds = [math]::Round($bootTimer.Elapsed.TotalSeconds, 2)
        emulatorLogs = @($stdoutLog, $stderrLog)
        avd = $actualAvdName
        serial = $script:deviceSerial
        api = [int]$sdkLevel.Trim()
        viewport = "390x844"
        package = $packageName
        activityFocused = $true
        imeShown = $true
        cardFrontendRuntime = $runtimeProbe
        screenshots = @($launchScreenshot, $settingsScreenshot, $imeScreenshot)
    } | ConvertTo-Json -Depth 8
} catch {
    throw "$($_.Exception.Message)`n$(Get-EmulatorLogTail)"
} finally {
    $freezerRestoreFailure = $null
    if ($cachedAppsFreezerChanged) {
        try {
            if ($previousCachedAppsFreezer -eq 'null') { Invoke-Adb shell settings delete global cached_apps_freezer | Out-Null }
            else { Invoke-Adb shell settings put global cached_apps_freezer $previousCachedAppsFreezer | Out-Null }
        } catch { $freezerRestoreFailure = $_ }
    }
    if ($testDataTouched -and $script:deviceSerial -match '^emulator-\d+$') {
        try { & $script:adbPath -s $script:deviceSerial shell input keyevent 4 | Out-Null } catch {}
        try { & $script:adbPath -s $script:deviceSerial shell am force-stop $packageName | Out-Null } catch {}
        try { & $script:adbPath -s $script:deviceSerial shell pm clear $packageName | Out-Null } catch {}
    }
    if ($emulatorStartedHere -and -not $KeepEmulator) {
        if ($script:deviceSerial -match '^emulator-\d+$') {
            try { & $script:adbPath -s $script:deviceSerial emu kill | Out-Null } catch {}
        }
        foreach ($process in @($emulatorChildren) + @($emulatorProcess)) {
            if ($process -and -not $process.HasExited) {
                if (-not $process.WaitForExit(5000)) { $process.Kill() }
            }
        }
    }
    if ($freezerRestoreFailure) { throw "Unable to restore cached_apps_freezer: $($freezerRestoreFailure.Exception.Message)" }
}
