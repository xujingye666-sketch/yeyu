function Test-QualityGateTrackedPath {
    param([string]$Path)
    $normalized = ($Path.Replace("\", "/") -replace '^(?:\./)+', '')
    if ($normalized -match '^tools/probes/') { return $false }
    if ($normalized -match '^(?:app|tools|gradle)/') { return $true }
    return $normalized -match '^(?:build\.gradle\.kts|settings\.gradle\.kts|gradle\.properties|package(?:-lock)?\.json|eslint\.config\.js)$'
}

# Formal releases are annotated tags: vX.Y.Z from 1.0.0 on, and the earlier vcNNN tags, which stay as
# they are. Every vX.Y.Z release is newer than every vcNNN one.
function Get-FormalReleaseTags {
    param([string]$Root)
    $rows = @(& git -C $Root for-each-ref '--format=%(refname:strip=2) %(objecttype)' 'refs/tags/v*')
    if ($LASTEXITCODE -ne 0) { throw "Unable to read local release tags" }
    $tags = foreach ($row in $rows) {
        $name, $type = ([string]$row).Trim() -split ' ', 2
        if ($type -ne 'tag') { continue }
        if ($name -match '^v(\d+)\.(\d+)\.(\d+)$') {
            [pscustomobject]@{ name = $name; rank = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3], 0) }
        } elseif ($name -match '^vc(\d+)$') {
            [pscustomobject]@{ name = $name; rank = [version]::new(0, 0, 0, [int]$Matches[1]) }
        }
    }
    return @($tags | Sort-Object rank -Descending)
}

function Get-GradleVersionCode {
    param([string]$GradleText)
    $match = [regex]::Match($GradleText, 'versionCode\s*=\s*(\d+)')
    if (-not $match.Success) { return $null }
    return [int]$match.Groups[1].Value
}

function Get-TaggedVersionCode {
    param([string]$Root, [string]$Tag)
    if ($Tag -match '^vc(\d+)$') { return [int]$Matches[1] }
    $versionCode = Get-GradleVersionCode ((& git -C $Root show "$Tag`:app/build.gradle.kts") -join "`n")
    if ($LASTEXITCODE -ne 0 -or $null -eq $versionCode) { throw "Unable to read versionCode at release tag $Tag" }
    return $versionCode
}

function Resolve-FastBaselineRef {
    param([string]$Root, [string]$BaselineRef)
    if (-not [string]::IsNullOrWhiteSpace($BaselineRef)) { return $BaselineRef }
    $latest = @(Get-FormalReleaseTags -Root $Root) | Select-Object -First 1
    if ($latest) { return $latest.name }
    throw "Fast gate requires a local annotated release tag (vX.Y.Z or vcNNN) or an explicit -BaselineRef"
}

function Get-QualityGateTrackedChanges {
    param([string]$Root, [string]$Ref)
    if ([string]::IsNullOrWhiteSpace($Ref)) { throw "Fast gate baseline ref cannot be empty" }
    & git -C $Root rev-parse --verify "$Ref`^{commit}" *> $null
    if ($LASTEXITCODE -ne 0) { throw "Fast gate baseline ref does not resolve to a commit: $Ref" }
    $paths = @(& git -C $Root -c core.quotepath=false diff --name-only --diff-filter=ACDMRTUXB $Ref --)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read tracked diff from baseline: $Ref" }
    $untracked = @(& git -C $Root -c core.quotepath=false ls-files --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read untracked files" }
    return @($paths + $untracked | ForEach-Object { ([string]$_).Trim().Replace("\", "/") } | Where-Object { $_ -and (Test-QualityGateTrackedPath $_) } | Sort-Object -Unique)
}

function Resolve-FastChangedPaths {
    param([string]$Root, [string]$BaselineRef, [string[]]$ExplicitPaths = @())
    $explicit = @($ExplicitPaths | ForEach-Object { ([string]$_).Trim().Replace("\", "/") } | Where-Object { $_ })
    return @($explicit + (Get-QualityGateTrackedChanges -Root $Root -Ref $BaselineRef) | Sort-Object -Unique)
}

function Resolve-ReleaseIdentity {
    param([string]$Root, [string]$SourceCommit)
    $requested = $SourceCommit.Trim().ToLowerInvariant()
    if ($requested -notmatch '^[0-9a-f]{40}$') { throw "Release requires an explicit full 40-character source commit" }

    $resolvedOutput = @(& git -C $Root rev-parse --verify "$requested`^{commit}" 2>&1)
    $resolved = if ($resolvedOutput.Count) { ([string]$resolvedOutput[0]).Trim().ToLowerInvariant() } else { "" }
    if ($LASTEXITCODE -ne 0 -or $resolved -ne $requested) { throw "Release source commit does not resolve exactly: $SourceCommit" }
    $head = ([string](& git -C $Root rev-parse HEAD)).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $head -ne $resolved) { throw "Release source commit must equal the current HEAD: source=$resolved head=$head" }

    $trackedChanges = @(& git -C $Root status --porcelain=v1 --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the tracked Git tree for Release" }
    if ($trackedChanges.Count) { throw "Release requires a clean tracked Git tree" }

    # Android uses main and variant source sets; the current Gradle project also reads
    # scripts, the wrapper/catalog and optional local libraries. Inspect these roots
    # even when a global ignore hides a source file. local.properties and build/report
    # output directories are not source inputs and remain allowed.
    $untrackedInputs = @(& git -C $Root -c core.quotepath=false ls-files --others -- `
        'app/src' 'app/libs' 'app/*.gradle' 'app/*.gradle.kts' `
        'gradle' 'buildSrc/src' 'buildSrc/*.gradle' 'buildSrc/*.gradle.kts' `
        'build.gradle' 'build.gradle.kts' 'settings.gradle' 'settings.gradle.kts' `
        'gradle.properties' 'gradlew' 'gradlew.bat')
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect untracked build inputs for Release" }
    if ($untrackedInputs.Count) { throw "Release rejects untracked build inputs: $($untrackedInputs -join ', ')" }

    $releaseTags = @(Get-FormalReleaseTags -Root $Root)
    if (-not $releaseTags.Count) { throw "Release requires at least one annotated release tag (vX.Y.Z or vcNNN)" }
    $gradleText = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "app\build.gradle.kts")
    $actualVersion = Get-GradleVersionCode $gradleText
    $nameMatch = [regex]::Match($gradleText, 'versionName\s*=\s*"([^"]+)"')
    if ($null -eq $actualVersion -or -not $nameMatch.Success) { throw "Release could not read versionCode and versionName from app/build.gradle.kts" }
    $versionName = $nameMatch.Groups[1].Value
    if ($versionName -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw "Release versionName must be a stable X.Y.Z version: $versionName" }
    $releaseRank = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3], 0)
    # Also catches a lightweight tag of that name, which the annotated-tag list leaves out.
    $existingTag = @(& git -C $Root tag --list "v$versionName")
    if ($LASTEXITCODE -ne 0) { throw "Unable to read local release tags" }
    if ($existingTag.Count) { throw "Release tag v$versionName already exists; choose a new versionName" }
    $latestTag = $releaseTags[0]
    if ($latestTag.rank -ge $releaseRank) { throw "Release versionName $versionName must be newer than the latest release tag $($latestTag.name)" }
    # Each release was gated to a higher versionCode than all before it, so the latest tag holds the highest.
    $highestVersion = Get-TaggedVersionCode -Root $Root -Tag $latestTag.name
    $expectedVersion = $highestVersion + 1
    if ($actualVersion -lt $expectedVersion) { throw "Release versionCode must be greater than every released versionCode: highest=$highestVersion minimum=$expectedVersion actual=$actualVersion" }

    return [pscustomobject][ordered]@{
        sourceCommit = $resolved
        headCommit = $head
        versionName = $versionName
        releaseTag = "v$versionName"
        latestReleaseTag = $latestTag.name
        highestVersionCode = $highestVersion
        expectedVersionCode = $expectedVersion
        actualVersionCode = $actualVersion
        trackedTreeClean = $true
    }
}

function Get-QualityGateOutcome {
    param(
        [ValidateSet("Fast", "Release")]
        [string]$Gate,
        [AllowNull()]
        [string]$Failure = $null
    )

    $checksPassed = [string]::IsNullOrWhiteSpace($Failure)
    [pscustomobject][ordered]@{
        schemaVersion = 4
        kind = "yeyu-quality-gate-summary"
        gate = $Gate
        checksPassed = $checksPassed
        validGatePass = $checksPassed
        failure = $Failure
        exitCode = if ($checksPassed) { 0 } else { 1 }
    }
}

function Write-QualityGateConclusion {
    param([Parameter(Mandatory = $true)][psobject]$Outcome)

    if (-not $Outcome.checksPassed) {
        Write-Host "Quality gate failed: $($Outcome.failure)"
        return
    }
    Write-Host "Quality gate passed: $($Outcome.gate)"
}

function Get-QualityGateExitCode {
    param([Parameter(Mandatory = $true)][psobject]$Outcome)
    return [int]$Outcome.exitCode
}
