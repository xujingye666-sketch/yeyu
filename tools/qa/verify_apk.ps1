param(
    [Parameter(Mandatory = $true)]
    [string]$Apk,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$SourceRef
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "android_environment.ps1")
$apkPath = (Resolve-Path $Apk).Path
$gradleText = Get-Content -Raw -Encoding UTF8 (Join-Path $root "app\build.gradle.kts")
$versionCode = [regex]::Match($gradleText, 'versionCode\s*=\s*(\d+)').Groups[1].Value
$versionName = [regex]::Match($gradleText, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
if (-not $versionCode -or -not $versionName) { throw "Unable to read version from app/build.gradle.kts" }

function Get-ByteHash {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [System.BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

$sdk = Resolve-AndroidSdk -ProjectRoot $root -RequireBuildTools -RequireApkAnalyzer
$buildTools = Get-ChildItem (Join-Path $sdk "build-tools") -Directory |
    Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName "aapt.exe") -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat") -PathType Leaf)
    } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
if (-not $buildTools) { throw "Android build-tools not found" }
$aapt = Join-Path $buildTools.FullName "aapt.exe"
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
$apkanalyzer = Join-Path $sdk "cmdline-tools\latest\bin\apkanalyzer.bat"
if (-not (Test-Path -LiteralPath $apkanalyzer -PathType Leaf)) { throw "Android SDK apkanalyzer not found" }
$env:JAVA_HOME = Resolve-AndroidJavaHome

$verificationApk = $apkPath
$temporaryApk = $null
$sourceArchive = $null
$resolvedRef = ""
if ($apkPath -match '[^\x00-\x7F]') {
    $temporaryApk = Join-Path $env:TEMP "yeyu-apk-check-$PID.apk"
    Copy-Item -LiteralPath $apkPath -Destination $temporaryApk -Force
    $verificationApk = $temporaryApk
}

function Get-ApkClassSmali {
    param([string]$ClassName)
    $lines = @(& $apkanalyzer dex code --class $ClassName $verificationApk 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "apkanalyzer could not inspect $ClassName`: $($lines -join ' ')" }
    $text = $lines -join "`n"
    if (-not $text.Trim()) { throw "apkanalyzer returned no class body for $ClassName" }
    return $text
}

try {
$resolvedOutput = @(& git -C $root rev-parse --verify "$SourceRef`^{commit}" 2>&1)
$resolveExitCode = $LASTEXITCODE
$resolvedRef = if ($resolvedOutput.Count) { ([string]$resolvedOutput[0]).Trim().ToLowerInvariant() } else { "" }
if ($resolveExitCode -ne 0 -or $resolvedRef -ne $SourceRef.ToLowerInvariant()) { throw "Unable to resolve exact source commit: $SourceRef" }

$badging = & $aapt dump badging $verificationApk 2>&1
if ($LASTEXITCODE -ne 0) { throw "aapt could not read APK: $badging" }
$badgingText = $badging -join "`n"
if ($badgingText -notmatch "package: name='com\.yeyu\.app'") { throw "APK package is not com.yeyu.app" }
if ($badgingText -notmatch "versionCode='$([regex]::Escape($versionCode))'") { throw "APK versionCode does not match source" }
if ($badgingText -notmatch "versionName='$([regex]::Escape($versionName))'") { throw "APK versionName does not match source" }
if ($badgingText -notmatch "sdkVersion:'33'") { throw "APK minSdk is not 33" }
if ($badgingText -notmatch "targetSdkVersion:'35'") { throw "APK targetSdk is not 35" }

$signature = & $apksigner verify --verbose --print-certs $verificationApk 2>&1
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed: $signature" }
$signatureText = $signature -join "`n"
if ($signatureText -notmatch 'Verified using v2 scheme .*: true') { throw "APK is missing a valid v2 signature" }
$expectedCertificate = "626d882b93d4a37ac03ecce4c177cd8321a83f6856969718c808e8faabf07bc5"
$certificate = [regex]::Match($signatureText, 'certificate SHA-256 digest:\s*([0-9a-fA-F]+)').Groups[1].Value.ToLowerInvariant()
if ($certificate -ne $expectedCertificate) { throw "APK certificate does not match original: $certificate" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($verificationApk)
try {
    $assetRoot = Join-Path $root "app\src\main\assets"
    $sourceAssets = @{}
    foreach ($file in Get-ChildItem $assetRoot -Recurse -File) {
        $relative = $file.FullName.Substring($assetRoot.Length + 1).Replace('\', '/')
        $sourceAssets[$relative] = $true
        $entry = $zip.GetEntry("assets/$relative")
        if (-not $entry) { throw "APK asset missing: assets/$relative" }
        $sourceBytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $stream = $entry.Open()
        try {
            $memory = New-Object System.IO.MemoryStream
            $stream.CopyTo($memory)
            $apkBytes = $memory.ToArray()
        } finally {
            $stream.Dispose()
        }
        if ($sourceBytes.Length -ne $apkBytes.Length -or (Get-ByteHash $sourceBytes) -ne (Get-ByteHash $apkBytes)) {
            throw "APK asset differs from source: assets/$relative"
        }
    }
    foreach ($entry in $zip.Entries | Where-Object { $_.FullName.StartsWith("assets/") -and -not $_.FullName.EndsWith("/") }) {
        $relative = $entry.FullName.Substring("assets/".Length)
        if (-not $sourceAssets.ContainsKey($relative)) { throw "APK contains an asset absent from source: $($entry.FullName)" }
    }

    $sourceArchive = Join-Path $env:TEMP "yeyu-source-assets-$PID.zip"
    & git -C $root archive --format=zip --output=$sourceArchive $resolvedRef app/src/main/assets
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sourceArchive)) { throw "Unable to archive source ref: $resolvedRef" }
    $archiveZip = [System.IO.Compression.ZipFile]::OpenRead($sourceArchive)
    try {
        $archiveAssets = @{}
        foreach ($entry in $archiveZip.Entries | Where-Object { $_.FullName.StartsWith("app/src/main/assets/") -and -not $_.FullName.EndsWith("/") }) {
            $relative = $entry.FullName.Substring("app/src/main/assets/".Length)
            $archiveAssets[$relative] = $true
            $apkEntry = $zip.GetEntry("assets/$relative")
            if (-not $apkEntry) { throw "APK asset missing from source ref $resolvedRef`: $relative" }
            $sourceStream = $entry.Open()
            $apkStream = $apkEntry.Open()
            try {
                $sourceMemory = New-Object System.IO.MemoryStream
                $apkMemory = New-Object System.IO.MemoryStream
                $sourceStream.CopyTo($sourceMemory)
                $apkStream.CopyTo($apkMemory)
                $sourceBytes = $sourceMemory.ToArray()
                $apkBytes = $apkMemory.ToArray()
            } finally {
                $sourceStream.Dispose()
                $apkStream.Dispose()
            }
            if ($sourceBytes.Length -ne $apkBytes.Length -or (Get-ByteHash $sourceBytes) -ne (Get-ByteHash $apkBytes)) {
                throw "APK asset differs from source ref $resolvedRef`: $relative"
            }
        }
        foreach ($entry in $zip.Entries | Where-Object { $_.FullName.StartsWith("assets/") -and -not $_.FullName.EndsWith("/") }) {
            $relative = $entry.FullName.Substring("assets/".Length)
            if (-not $archiveAssets.ContainsKey($relative)) { throw "APK contains asset absent from source ref $resolvedRef`: $relative" }
        }
    } finally {
        $archiveZip.Dispose()
    }
    Write-Host "APK assets match Git source commit byte-for-byte: $resolvedRef"

    $expectedIconHash = "f54eb61005d2228a3b12b6fc743e8e577c0b8715a5202410cdcf0b55154ec6ca"
    $sourceIcons = @(Get-ChildItem (Join-Path $root "app\src\main\res") -Recurse -File -Filter "ic_launcher*.jpg")
    if ($sourceIcons.Count -lt 2) { throw "Launcher icon sources are incomplete" }
    foreach ($icon in $sourceIcons) {
        if ((Get-FileHash -LiteralPath $icon.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedIconHash) {
            throw "Launcher icon source hash changed: $($icon.FullName)"
        }
    }
    $packagedIconHashes = @($zip.Entries | Where-Object { $_.FullName -like "res/*.jpg" } | ForEach-Object {
        $stream = $_.Open()
        try {
            $memory = New-Object System.IO.MemoryStream
            $stream.CopyTo($memory)
            Get-ByteHash $memory.ToArray()
        } finally {
            $stream.Dispose()
        }
    })
    if ($expectedIconHash -notin $packagedIconHashes) { throw "APK does not contain the approved launcher icon bytes" }

    $dexEntries = @($zip.Entries | Where-Object { $_.FullName -match '^classes(?:\d+)?\.dex$' })
    if (-not $dexEntries.Count) { throw "APK contains no DEX files" }
    $dexStrings = [System.Text.StringBuilder]::new()
    foreach ($dex in $dexEntries) {
        $dexStream = $dex.Open()
        try {
            $memory = New-Object System.IO.MemoryStream
            $dexStream.CopyTo($memory)
            [void]$dexStrings.Append([System.Text.Encoding]::UTF8.GetString($memory.ToArray()))
        } finally {
            $dexStream.Dispose()
        }
    }
    foreach ($symbol in @("AndroidBridge", "JavascriptInterface", "onShowFileChooser", "onActivityResult", "saveFile", "fetchCardImage", "setCardFrontendFullscreenMode", "MediaStore")) {
        if (-not $dexStrings.ToString().Contains($symbol)) { throw "DEX precheck is missing native capability string: $symbol" }
    }

    $bridgeClass = "com.yeyu.app.MainActivity`$AndroidBridge"
    $bridgeSmali = Get-ApkClassSmali -ClassName $bridgeClass
    if ($bridgeSmali -notmatch '(?m)^\.class public final Lcom/yeyu/app/MainActivity\$AndroidBridge;$') { throw "APK is missing the concrete AndroidBridge class" }
    $annotatedSignatures = @([regex]::Matches($bridgeSmali, '(?ms)^\.method\s+(?<header>[^\r\n]+)\r?\n(?<body>.*?^\.end method)') | ForEach-Object {
        if ($_.Groups['body'].Value -match '(?m)^\s*\.annotation runtime Landroid/webkit/JavascriptInterface;$') {
            $signature = [regex]::Match($_.Groups['header'].Value, '(?<signature>[A-Za-z0-9_$<>-]+\([^)]*\).+)$')
            if (-not $signature.Success) { throw "Unable to parse annotated bridge method: $($_.Groups['header'].Value)" }
            $signature.Groups['signature'].Value
        }
    } | Sort-Object)
    $expectedBridgeSignatures = @(
        'fetchCardImage(Ljava/lang/String;Ljava/lang/String;)V',
        'cancelCardImage(Ljava/lang/String;)V',
        'hapticLongPress()V',
        'onWebViewPauseReady(Ljava/lang/String;Z)V',
        'saveFile(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
        'setCardFrontendFullscreenMode(Ljava/lang/String;)V',
        'setSystemBars(Z)V'
    ) | Sort-Object
    $bridgeDifference = @(Compare-Object -ReferenceObject $expectedBridgeSignatures -DifferenceObject $annotatedSignatures)
    if ($bridgeDifference.Count) { throw "APK JavascriptInterface allowlist differs: $($bridgeDifference | Out-String)" }

    $activitySmali = Get-ApkClassSmali -ClassName "com.yeyu.app.MainActivity"
    foreach ($signature in @(
        'onActivityResult\(IILandroid/content/Intent;\)V',
        'performSave\(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;\)Ljava/lang/String;'
    )) {
        if ($activitySmali -notmatch "(?m)^\.method [^\r\n]*$signature$") { throw "APK MainActivity is missing required method: $signature" }
    }
    $performSaveMatch = [regex]::Match($activitySmali, '(?ms)^\.method private performSave\([^\r\n]+\)Ljava/lang/String;\r?\n(?<body>.*?^\.end method)')
    if (-not $performSaveMatch.Success) { throw "APK could not isolate the performSave method body" }
    $performSaveBody = $performSaveMatch.Groups['body'].Value
    foreach ($pattern in @(
        'const-string [^\r\n]+, "is_pending"',
        'const-string [^\r\n]+, "relative_path"',
        'Landroid/provider/MediaStore\$Downloads;->EXTERNAL_CONTENT_URI:Landroid/net/Uri;',
        'Landroid/content/ContentResolver;->insert',
        'Landroid/content/ContentResolver;->openOutputStream',
        'Landroid/content/ContentResolver;->update',
        'Landroid/content/ContentResolver;->delete'
    )) {
        if ($performSaveBody -notmatch $pattern) { throw "APK performSave method is missing required MediaStore operation: $pattern" }
    }
    $chromeClientSmali = Get-ApkClassSmali -ClassName "com.yeyu.app.MainActivity`$1"
    if ($chromeClientSmali -notmatch '(?m)^\.method public onShowFileChooser\(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient\$FileChooserParams;\)Z$') {
        throw "APK WebChromeClient is missing the file chooser method"
    }
} finally {
    $zip.Dispose()
}

Write-Host "APK checks passed: com.yeyu.app $versionName ($versionCode), minSdk 33, targetSdk 35, v2, original certificate"
$apkReport = [ordered]@{
    schemaVersion = 1
    kind = "yeyu-apk-verification"
    apk = $apkPath
    byteLength = (Get-Item -LiteralPath $apkPath).Length
    sha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    package = "com.yeyu.app"
    versionCode = [int]$versionCode
    versionName = $versionName
    sourceCommit = $resolvedRef
    certificateSha256 = $certificate
    dexFiles = $dexEntries.Count
    javascriptInterfaces = @($annotatedSignatures)
    nativeMethodChecks = @("onShowFileChooser", "onActivityResult", "performSave/MediaStore")
}
Write-Host "APK_VERIFICATION_JSON=$($apkReport | ConvertTo-Json -Depth 4 -Compress)"
} finally {
    if ($temporaryApk -and (Test-Path -LiteralPath $temporaryApk)) {
        Remove-Item -LiteralPath $temporaryApk -Force
    }
    if ($sourceArchive -and (Test-Path -LiteralPath $sourceArchive)) {
        Remove-Item -LiteralPath $sourceArchive -Force
    }
}
