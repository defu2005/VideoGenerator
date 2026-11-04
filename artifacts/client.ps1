# Call the remote Ollama endpoint from Windows PowerShell.
# Requires:
#   $env:OLLAMA_BASE_URL  e.g. https://name.trycloudflare.com
#   $env:OLLAMA_TOKEN     bearer token (do not commit)
# Usage:
#   .\client.ps1 "Xin chào, hãy giới thiệu bản thân."

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Prompt
)

$ErrorActionPreference = "Stop"
$base = $env:OLLAMA_BASE_URL
$token = $env:OLLAMA_TOKEN
$model = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { "llama3.2:1b" }
$timeoutSec = if ($env:OLLAMA_TIMEOUT) { [int]$env:OLLAMA_TIMEOUT } else { 180 }

if (-not $base -or -not $token) {
    Write-Error "Set OLLAMA_BASE_URL and OLLAMA_TOKEN."
    exit 2
}

$uri = ($base.TrimEnd("/")) + "/api/generate"
$body = @{
    model  = $model
    prompt = $Prompt
    stream = $false
} | ConvertTo-Json -Compress

try {
    $response = Invoke-RestMethod -Method Post -Uri $uri -TimeoutSec $timeoutSec `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
} catch [System.Net.WebException] {
    Write-Error ("Connection error: " + $_.Exception.Message)
    exit 1
} catch {
    Write-Error $_.Exception.Message
    exit 1
}

if ($null -eq $response.response) {
    $response | ConvertTo-Json -Depth 6
    exit 1
}
Write-Output $response.response
