param(
    [ValidateSet("Fast", "Release")]
    [string]$Gate = "Release",
    [string[]]$TestScript = @(),
    [string[]]$ChangedPath = @(),
    [string]$BaselineRef = "",
    [string]$SourceCommit = "",
    [ValidateRange(1, 8)]
    [int]$Jobs = 4,
    [switch]$BaseOnly
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$totalTimer = [System.Diagnostics.Stopwatch]::StartNew()
$timings = [System.Collections.Generic.List[object]]::new()
$failure = $null
$qualityOutcome = $null
$releaseIdentity = $null
. (Join-Path $PSScriptRoot "quality_gate_contract.ps1")
. (Join-Path $PSScriptRoot "android_environment.ps1")
$changedSelectors = @($ChangedPath | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$explicitChangedSelectors = @($changedSelectors)
$autoChangedPaths = @()
$selectorActive = $false

function Invoke-Checked {
    param([string]$Label, [scriptblock]$Command)
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "[$Label]"
    & $Command
    $exitCode = $LASTEXITCODE
    $timer.Stop()
    if ($null -ne $exitCode -and $exitCode -ne 0) { throw "$Label failed with exit code $exitCode" }
    $timings.Add([pscustomobject]@{ step = $Label; seconds = [math]::Round($timer.Elapsed.TotalSeconds, 2) })
}

function Invoke-JavaScriptSyntax {
    Get-ChildItem "app\src\main\assets\js" -Recurse -File -Filter *.js | ForEach-Object {
        & node --check $_.FullName
        if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax failed: $($_.FullName)" }
    }
}

function Invoke-TestScheduler {
    $arguments = @("tools\tests\run_all.js", "--gate", $Gate, "--jobs", $Jobs)
    foreach ($changed in $changedSelectors) { $arguments += @("--changed", $changed) }
    foreach ($test in @($TestScript | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })) { $arguments += @("--test", $test) }
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Declared JavaScript regression scheduler failed" }
}

function Initialize-BrowserRuntime {
    $runtimeJson = @(& node -e "process.stdout.write(JSON.stringify(require('./tools/tests/source').resolvePlaywrightRuntime()))")
    if ($LASTEXITCODE -ne 0 -or -not $runtimeJson) { throw "Playwright runtime discovery failed" }
    $runtime = ($runtimeJson -join "") | ConvertFrom-Json
    if (-not $runtime.nodePath -or -not $runtime.edgePath) { throw "Playwright runtime discovery returned incomplete paths" }
    $separator = [IO.Path]::PathSeparator
    $current = @($env:NODE_PATH -split [regex]::Escape([string]$separator) | Where-Object { $_ })
    if ($current -notcontains [string]$runtime.nodePath) {
        $runtimePaths = @([string]$runtime.nodePath) + $current
        $env:NODE_PATH = $runtimePaths -join $separator
    }
    $env:YEYU_EDGE_PATH = [string]$runtime.edgePath
    & node -e "require('playwright'); console.log('Playwright ready')"
    if ($LASTEXITCODE -ne 0) { throw "Playwright runtime could not be reused by child tests" }
}

Push-Location $root
try {
    if ($BaseOnly -and $Gate -ne "Fast") { throw "-BaseOnly is supported only with -Gate Fast" }
    if ($BaseOnly -and ($changedSelectors.Count -gt 0)) { throw "-BaseOnly cannot be combined with -ChangedPath" }
    if ($Gate -eq "Fast" -and -not $BaseOnly) {
        $BaselineRef = Resolve-FastBaselineRef -Root $root -BaselineRef $BaselineRef
        $changedSelectors = Resolve-FastChangedPaths -Root $root -BaselineRef $BaselineRef -ExplicitPaths $changedSelectors
        $autoChangedPaths = @($changedSelectors | Where-Object { $explicitChangedSelectors -notcontains $_ })
    }
    $selectorActive = $changedSelectors.Count -gt 0
    if ($Gate -ne "Fast" -and $selectorActive) { throw "-ChangedPath is supported only with -Gate Fast; Release must run the complete declared regression set" }
    if ($Gate -eq "Release") {
        Invoke-Checked "Release source identity" { $script:releaseIdentity = Resolve-ReleaseIdentity -Root $root -SourceCommit $SourceCommit }
    }
    Invoke-Checked "Project and protected boundary checks" { python tools\qa\check_project.py }
    if ($Gate -ne "Fast") { Invoke-Checked "HTML checker self-test" { python tools\qa\check_assets.py --self-test } }
    Invoke-Checked "HTML and assets" { python tools\qa\check_assets.py }
    Invoke-Checked "JavaScript syntax" { Invoke-JavaScriptSyntax }
    Invoke-Checked "ESLint globals and declarations" {
        if (-not (Test-Path (Join-Path $root "node_modules\eslint\bin\eslint.js"))) {
            throw "ESLint dependencies are missing. Run npm ci in the project root first; the gate does not install dependencies."
        }
        & npm run lint
    }
    Invoke-Checked "Browser test runtime discovery" { Initialize-BrowserRuntime }
    Invoke-Checked "Declared JavaScript regressions" { Invoke-TestScheduler }
    if ($Gate -eq "Release") {
        $env:JAVA_HOME = Resolve-AndroidJavaHome
        $env:ANDROID_SDK_ROOT = Resolve-AndroidSdk -ProjectRoot $root -RequirePlatform35
        $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
        Invoke-Checked "Gradle Lint and Debug" { .\gradlew.bat :app:lintDebug :app:assembleDebug --daemon --configuration-cache }
        Invoke-Checked "Original-signed Release" { .\gradlew.bat :app:assembleRelease --daemon --configuration-cache }
        Invoke-Checked "APK identity, signature, assets, icons, and native capabilities" { & (Join-Path $PSScriptRoot "verify_apk.ps1") -Apk "app\build\outputs\apk\release\app-release.apk" -SourceRef ([string]$releaseIdentity.sourceCommit) }
    }
} catch {
    $failure = $_.Exception.Message
} finally {
    Pop-Location
    $totalTimer.Stop()
    $qualityOutcome = Get-QualityGateOutcome -Gate $Gate -Failure $failure
    $summaryObject = [ordered]@{}
    foreach ($property in $qualityOutcome.PSObject.Properties) { $summaryObject[$property.Name] = $property.Value }
    $summaryObject.selectorActive = $selectorActive
    $summaryObject.baseOnly = [bool]$BaseOnly
    $summaryObject.baselineRef = if ($Gate -eq "Fast") { $BaselineRef } else { "" }
    $summaryObject.autoChangedPaths = @($autoChangedPaths)
    $summaryObject.selectedChangedPaths = @($changedSelectors)
    $summaryObject.releaseIdentity = $releaseIdentity
    $summaryObject.steps = @($timings)
    $summaryObject.totalSeconds = [math]::Round($totalTimer.Elapsed.TotalSeconds, 2)
    $summary = $summaryObject | ConvertTo-Json -Depth 5 -Compress
    Write-Host "QUALITY_GATE_SUMMARY_JSON=$summary"
}
Write-QualityGateConclusion -Outcome $qualityOutcome
exit (Get-QualityGateExitCode -Outcome $qualityOutcome)
