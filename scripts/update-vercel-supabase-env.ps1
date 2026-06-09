# Updates Vercel env vars after Supabase key rotation, then disables legacy JWT keys.
# Requires: VERCEL_TOKEN (https://vercel.com/account/tokens)
# Reads new key from .env.local (VITE_SUPABASE_ANON_KEY) unless -AnonKey is passed.

param(
    [string]$ProjectName = "recipe-book-gh-pages",
    [string]$TeamId = "team_FSL9SZgVqM9VPGXjNIzsBD45",
    [string]$SupabaseProjectRef = "nklwzunoipplfkysaztl",
    [string]$AnonKey = "",
    [switch]$DisableLegacyKeys
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

if (-not $env:VERCEL_TOKEN) {
    Write-Error "VERCEL_TOKEN is not set. Create one at https://vercel.com/account/tokens"
}

if (-not $AnonKey) {
    $envFile = Join-Path $repoRoot ".env.local"
    if (-not (Test-Path $envFile)) {
        Write-Error ".env.local not found. Run key rotation first or pass -AnonKey."
    }
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*VITE_SUPABASE_ANON_KEY=(.+)$') {
            $AnonKey = $Matches[1].Trim().Trim('"')
            break
        }
    }
}

if (-not $AnonKey) {
    Write-Error "VITE_SUPABASE_ANON_KEY missing from .env.local"
}

$supabaseUrl = "https://$SupabaseProjectRef.supabase.co"
$vercelHeaders = @{
    Authorization = "Bearer $($env:VERCEL_TOKEN)"
    "Content-Type" = "application/json"
}

function Set-VercelEnv {
    param([string]$Key, [string]$Value)
    $body = @(
        @{
            key    = $Key
            value  = $Value
            type   = "encrypted"
            target = @("production", "preview", "development")
        }
    ) | ConvertTo-Json -Depth 5
    $uri = "https://api.vercel.com/v10/projects/$ProjectName/env?upsert=true&teamId=$TeamId"
    Invoke-RestMethod -Uri $uri -Headers $vercelHeaders -Method Post -Body $body | Out-Null
    Write-Host "Updated Vercel env: $Key"
}

Set-VercelEnv -Key "VITE_SUPABASE_URL" -Value $supabaseUrl
Set-VercelEnv -Key "VITE_SUPABASE_ANON_KEY" -Value $AnonKey
Set-VercelEnv -Key "SUPABASE_URL" -Value $supabaseUrl
Set-VercelEnv -Key "SUPABASE_ANON_KEY" -Value $AnonKey

Write-Host "Vercel env updated for $ProjectName. Trigger redeploy from dashboard or push to main."

if ($DisableLegacyKeys) {
    $sbToken = $env:SUPABASE_ACCESS_TOKEN
    if (-not $sbToken) {
        $mcpPath = Join-Path $env:USERPROFILE ".cursor\mcp.json"
        if (Test-Path $mcpPath) {
            $mcp = Get-Content $mcpPath -Raw | ConvertFrom-Json
            $auth = $mcp.mcpServers.'supabase-shoppinglist'.headers.Authorization
            if ($auth) { $sbToken = $auth -replace '^Bearer ','' }
        }
    }
    if (-not $sbToken) {
        Write-Error "SUPABASE_ACCESS_TOKEN not set and could not read from Cursor MCP config."
    }
    $sbHeaders = @{ Authorization = "Bearer $sbToken" }
    Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$SupabaseProjectRef/api-keys/legacy?enabled=false" -Headers $sbHeaders -Method Put | Out-Null
    Write-Host "Legacy Supabase JWT keys disabled."
}
