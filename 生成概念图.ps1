param(
    [switch]$Test,
    [string]$Model = "gemini-2.5-flash-image",
    [string]$Prompt = "",
    [string]$OutFile = "",
    [string]$AspectRatio = "16:9",
    [string]$ImageSize = ""
)

$ErrorActionPreference = "Stop"

function Get-GeminiApiKey {
    param([string]$RootDir)
    if ($env:GEMINI_API_KEY) { return $env:GEMINI_API_KEY.Trim() }
    if ($env:GOOGLE_API_KEY) { return $env:GOOGLE_API_KEY.Trim() }

    $envPath = Join-Path $RootDir ".env"
    if (Test-Path $envPath) {
        foreach ($line in Get-Content $envPath -Encoding UTF8) {
            if ($line -match '^\s*#') { continue }
            if ($line -match '^\s*([^=]+?)\s*=\s*(.+?)\s*$') {
                $k = $Matches[1].Trim().ToLowerInvariant()
                if ($k -eq "gemini_api_key" -or $k -eq "google_api_key") {
                    $v = $Matches[2].Trim()
                    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
                        $v = $v.Substring(1, $v.Length - 2)
                    }
                    return $v.Trim()
                }
            }
        }
    }
    throw "未在环境变量或 .env 文件中找到 gemini_api_key。"
}

function Read-HttpErrorBody {
    param($Exception)
    if ($Exception.Response -and $Exception.Response.GetResponseStream) {
        try {
            $reader = New-Object System.IO.StreamReader($Exception.Response.GetResponseStream())
            return $reader.ReadToEnd()
        } catch {}
    }
    return $Exception.Message
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiKey = Get-GeminiApiKey -RootDir $root

if ($Test) {
    $uri = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"
    $headers = @{ "x-goog-api-key" = $apiKey }
    try {
        $resp = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 30
        Write-Output "API Key 验证成功！可用模型总数: $($resp.models.Count)"
        $imgModels = $resp.models | Where-Object { $_.name -match 'image|imagen' } | ForEach-Object {
            $shortName = $_.name -replace '^models/', ''
            "$shortName | methods: $($_.supportedGenerationMethods -join ',')"
        }
        Write-Output "--- 图像相关模型 ---"
        $imgModels | ForEach-Object { Write-Output $_ }
    } catch {
        $errBody = Read-HttpErrorBody $_.Exception
        Write-Error "API Key 测试失败: $errBody"
        exit 1
    }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Prompt)) {
    throw "请提供 -Prompt 参数，或使用 -Test 测试 API Key。"
}
if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $OutFile = Join-Path $root ("generated_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".png")
}

$imageConfig = @{ aspectRatio = $AspectRatio }
if (-not [string]::IsNullOrWhiteSpace($ImageSize)) {
    $imageConfig["imageSize"] = $ImageSize
}

$payload = @{
    contents = @(
        @{
            role = "user"
            parts = @(
                @{ text = $Prompt }
            )
        }
    )
    generationConfig = @{
        responseModalities = @("TEXT", "IMAGE")
        imageConfig = $imageConfig
    }
} | ConvertTo-Json -Depth 10

$uri = "https://generativelanguage.googleapis.com/v1beta/models/$Model`:generateContent"
$headers = @{
    "x-goog-api-key" = $apiKey
    "Content-Type" = "application/json; charset=utf-8"
}

try {
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $bodyBytes -TimeoutSec 120
} catch {
    $errBody = Read-HttpErrorBody $_.Exception
    Write-Error "请求模型 $Model 失败: $errBody"
    exit 1
}

$saved = $false
if ($resp.candidates -and $resp.candidates.Count -gt 0) {
    foreach ($part in $resp.candidates[0].content.parts) {
        if ($part.text) {
            Write-Output "[模型文本说明] $($part.text)"
        }
        if ($part.inlineData -and $part.inlineData.data) {
            $bytes = [Convert]::FromBase64String($part.inlineData.data)
            $mime = $part.inlineData.mimeType
            $finalPath = $OutFile
            if ($mime -eq "image/jpeg" -and $finalPath.EndsWith(".png")) {
                $finalPath = $finalPath -replace '\.png$', '.jpg'
            } elseif ($mime -eq "image/png" -and $finalPath.EndsWith(".jpg")) {
                $finalPath = $finalPath -replace '\.jpg$', '.png'
            }
            [System.IO.File]::WriteAllBytes($finalPath, $bytes)
            Write-Output "已保存图片 ($mime, $($bytes.Length) bytes): $finalPath"
            $saved = $true
        }
    }
}

if (-not $saved) {
    Write-Error "响应中未包含图片数据。完整返回: $($resp | ConvertTo-Json -Depth 6)"
    exit 1
}
