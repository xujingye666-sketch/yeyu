param(
    [Parameter(Mandatory = $true)]
    [string]$ReferenceRoot,
    [switch]$RequireReady
)

$ErrorActionPreference = 'Stop'
$referenceRoot = (Resolve-Path -LiteralPath $ReferenceRoot).Path
$assistantRoot = Join-Path $referenceRoot 'data\default-user\extensions\JS-Slash-Runner'
$templateRoot = Join-Path $referenceRoot 'data\default-user\extensions\ST-Prompt-Template'

function Invoke-ReferenceGit {
    param([string]$WorkingDirectory, [string[]]$GitArguments)
    $output = & git -C $WorkingDirectory @GitArguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git 核验失败：$WorkingDirectory" }
    return ($output -join "`n").Trim()
}

function Get-ReferenceComponent {
    param([string]$Root, [string]$ManifestPath, [string]$DistPath)
    $manifest = Get-Content -LiteralPath (Join-Path $Root $ManifestPath) -Raw | ConvertFrom-Json
    return [ordered]@{
        version = [string]$manifest.version
        head = Invoke-ReferenceGit -WorkingDirectory $Root -GitArguments @('rev-parse', 'HEAD')
        clean = -not [bool](Invoke-ReferenceGit -WorkingDirectory $Root -GitArguments @('status', '--porcelain'))
        distSha256 = (Get-FileHash -LiteralPath (Join-Path $Root $DistPath) -Algorithm SHA256).Hash
    }
}

if (-not (Test-Path -LiteralPath $referenceRoot -PathType Container)) { throw "缺少 SillyTavern 对照目录：$referenceRoot" }
$package = Get-Content -LiteralPath (Join-Path $referenceRoot 'package.json') -Raw | ConvertFrom-Json
$configText = Get-Content -LiteralPath (Join-Path $referenceRoot 'config.yaml') -Raw
$ready = $false
try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/' -UseBasicParsing -TimeoutSec 2
    $ready = $response.StatusCode -eq 200
} catch {}
if ($RequireReady -and -not $ready) { throw 'SillyTavern 未在 http://127.0.0.1:8000/ 就绪' }

$result = [ordered]@{
    checkedAt = (Get-Date).ToString('o')
    url = 'http://127.0.0.1:8000/'
    ready = $ready
    sillyTavern = [ordered]@{
        version = [string]$package.version
        head = Invoke-ReferenceGit -WorkingDirectory $referenceRoot -GitArguments @('rev-parse', 'HEAD')
        describe = Invoke-ReferenceGit -WorkingDirectory $referenceRoot -GitArguments @('describe', '--tags', '--always')
        clean = -not [bool](Invoke-ReferenceGit -WorkingDirectory $referenceRoot -GitArguments @('status', '--porcelain'))
        listen = if ($configText -match '(?m)^listen:\s*(\S+)') { $Matches[1] } else { $null }
        port = if ($configText -match '(?m)^port:\s*(\d+)') { [int]$Matches[1] } else { $null }
        allowKeysExposure = if ($configText -match '(?m)^allowKeysExposure:\s*(\S+)') { $Matches[1] } else { $null }
    }
    jsSlashRunner = Get-ReferenceComponent -Root $assistantRoot -ManifestPath 'manifest.json' -DistPath 'dist\index.js'
    promptTemplate = Get-ReferenceComponent -Root $templateRoot -ManifestPath 'manifest.json' -DistPath 'dist\index.js'
}

$expected = @{
    sillyTavern = @{ version = '1.19.0'; head = '7e8663cd9c184a550b37238218bdd32c6efc68e9' }
    jsSlashRunner = @{ version = '4.11.3'; head = '1292dbfa0f16943f70d55cfdf3bb5a0ce690ef8b'; distSha256 = 'E735F6EE5A0C2198DC980847F9B6284E3D36D6B394BBE38B0C4D801482FBA7F7' }
    promptTemplate = @{ version = '1.17.9'; head = 'd6f520d149aba146305b0b781ddd691d449c28d2'; distSha256 = '07190ADDBAE12F348CB7944DE1D5A125E1C1F686DD82540721AE58C8868A63E3' }
}
foreach ($component in $expected.Keys) {
    foreach ($field in $expected[$component].Keys) {
        if ($result[$component][$field] -ne $expected[$component][$field]) { throw "固定参考身份不符：$component.$field" }
    }
    if (-not $result[$component].clean) { throw "固定参考有未提交源码改动：$component" }
}
if ($result.sillyTavern.listen -ne 'false' -or $result.sillyTavern.port -ne 8000 -or $result.sillyTavern.allowKeysExposure -ne 'false') {
    throw '固定参考服务配置不符'
}
$result | ConvertTo-Json -Depth 6
