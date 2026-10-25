function ConvertFrom-AndroidPropertyPath {
    param([string]$Value)
    if (-not $Value) { return "" }
    return $Value.Trim().Replace('\:', ':').Replace('\\', '\')
}

function Get-AndroidSdkFromLocalProperties {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)
    $localProperties = Join-Path $ProjectRoot "local.properties"
    if (-not (Test-Path -LiteralPath $localProperties)) { return "" }
    $line = Get-Content -LiteralPath $localProperties -Encoding UTF8 |
        Where-Object { $_ -match '^\s*sdk\.dir\s*=' } |
        Select-Object -First 1
    if (-not $line) { return "" }
    return ConvertFrom-AndroidPropertyPath (($line -split '=', 2)[1])
}

function Test-AndroidSdkBuildTools {
    param([string]$SdkRoot)
    $buildToolsRoot = Join-Path $SdkRoot "build-tools"
    if (-not (Test-Path -LiteralPath $buildToolsRoot -PathType Container)) { return $false }
    return $null -ne (Get-ChildItem -LiteralPath $buildToolsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object {
            (Test-Path -LiteralPath (Join-Path $_.FullName "aapt.exe") -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat") -PathType Leaf)
        } |
        Select-Object -First 1)
}

function Resolve-AndroidSdk {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [switch]$RequirePlatform35,
        [switch]$RequireAdb,
        [switch]$RequireEmulator,
        [switch]$RequireBuildTools,
        [switch]$RequireApkAnalyzer
    )
    $fromProperties = Get-AndroidSdkFromLocalProperties -ProjectRoot $ProjectRoot
    $candidates = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        $fromProperties,
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Android\Sdk" })
    ) | Where-Object { $_ } | Select-Object -Unique
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { continue }
        $resolved = (Resolve-Path -LiteralPath $candidate).Path
        if ($RequirePlatform35 -and -not (Test-Path -LiteralPath (Join-Path $resolved "platforms\android-35\android.jar") -PathType Leaf)) { continue }
        if ($RequireAdb -and -not (Test-Path -LiteralPath (Join-Path $resolved "platform-tools\adb.exe") -PathType Leaf)) { continue }
        if ($RequireEmulator -and -not (Test-Path -LiteralPath (Join-Path $resolved "emulator\emulator.exe") -PathType Leaf)) { continue }
        if ($RequireBuildTools -and -not (Test-AndroidSdkBuildTools -SdkRoot $resolved)) { continue }
        if ($RequireApkAnalyzer -and -not (Test-Path -LiteralPath (Join-Path $resolved "cmdline-tools\latest\bin\apkanalyzer.bat") -PathType Leaf)) { continue }
        return $resolved
    }
    $requirements = @()
    if ($RequirePlatform35) { $requirements += "Platform 35" }
    if ($RequireAdb) { $requirements += "adb" }
    if ($RequireEmulator) { $requirements += "Android Emulator" }
    if ($RequireBuildTools) { $requirements += "build-tools" }
    if ($RequireApkAnalyzer) { $requirements += "apkanalyzer" }
    $requiredText = if ($requirements.Count) { " with " + ($requirements -join ", ") } else { "" }
    throw "Android SDK$requiredText not found. Set ANDROID_SDK_ROOT/ANDROID_HOME, set sdk.dir in local.properties, or install the required SDK components."
}

function Resolve-AndroidJavaHome {
    param(
        [string[]]$AndroidStudioCandidates = @(
            "C:\Program Files\Android\Android Studio\jbr",
            "C:\Program Files\Android\Android Studio\jre"
        )
    )
    $candidates = @(
        $env:JAVA_HOME,
        $AndroidStudioCandidates
    ) | Where-Object { $_ } | Select-Object -Unique
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $candidate "bin\java.exe") -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    $java = Get-Command java -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($java) {
        $javaPath = if ($java.Path) { $java.Path } else { $java.Source }
        $javaHomePath = Split-Path -Parent (Split-Path -Parent $javaPath)
        if (Test-Path -LiteralPath (Join-Path $javaHomePath "bin\java.exe") -PathType Leaf) { return $javaHomePath }
    }
    throw "JDK not found. Set JAVA_HOME, add Java to PATH, or install the Android Studio bundled JDK."
}
