# =====================================================================
#  MANARAT QURTUBAH - DIAGNOSTIC BUNDLE COLLECTOR (READ-ONLY)
# =====================================================================
#  PURPOSE
#    Collects ONLY the files needed to diagnose:
#      (1) Broken UI / Tailwind CSS (page renders plain white, no styles)
#      (2) Login failure for the 5 predefined role accounts
#    ...and merges them into ONE text file saved in the project root:
#      manarat-diagnostic-bundle.txt
#
#  SAFETY GUARANTEES
#    - 100% READ-ONLY. This script never edits, moves, renames or deletes
#      any project file. The only file it creates is the output bundle.
#    - Uses an explicit allow-list of known paths. It NEVER scans
#      node_modules, .next, .git, dist, build, coverage or any cache.
#    - NEVER writes .env VALUES to the bundle. For every .env* file
#      (including .env.example) it lists variable NAMES only, as
#      NAME=[REDACTED].
#    - Never asks for, reads or prints any account password.
#
#  HOW TO RUN (from the project root D:\DevCore\Teachers-platform)
#    powershell -NoProfile -ExecutionPolicy Bypass -File .\collect-manarat-diagnostic.ps1
# =====================================================================

 $ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---------------------------------------------------------------------
# 0) Safety check: the current directory must be the project root
# ---------------------------------------------------------------------
 $Root = (Get-Location).Path
if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json') -PathType Leaf)) {
    Write-Host ''
    Write-Host 'ERROR: package.json was not found in the current directory:' -ForegroundColor Red
    Write-Host "       $Root"
    Write-Host 'Open the terminal in the project root first, for example:'
    Write-Host '    cd D:\DevCore\Teachers-platform'
    exit 1
}

 $OutputPath = Join-Path $Root 'manarat-diagnostic-bundle.txt'

Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ' MANARAT QURTUBAH - DIAGNOSTIC BUNDLE COLLECTOR (READ-ONLY)'           -ForegroundColor Cyan
Write-Host "   Project root : $Root"
Write-Host "   Output file  : $OutputPath"
Write-Host '======================================================================' -ForegroundColor Cyan

# ---------------------------------------------------------------------
# 1) Explicit file allow-list (relative paths)
#    Variants of the same config are listed together; anything that does
#    not exist is reported in the missing-files section (which is itself
#    a diagnostic clue - e.g. no tailwind.config, no seed script).
# ---------------------------------------------------------------------
 $Files = @(
    # ---- [A] Root build / CSS configuration  (UI - Tailwind problem) ----
    'package.json',
    'next.config.ts', 'next.config.mjs', 'next.config.js',
    'tsconfig.json',
    'postcss.config.mjs', 'postcss.config.js', 'postcss.config.cjs',
    'tailwind.config.ts', 'tailwind.config.js',
    'components.json',

    # ---- [B] Global CSS, design tokens, root layout  (UI problem) ----
    'src/app/globals.css',
    'src/app/globals.css.bak',
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'src/lib/utils.ts',
    'src/config/branding.ts',
    'src/components/layout/app-shell.tsx',
    'src/components/ui/button.tsx',

    # ---- [C] Middleware, login page, auth actions, auth library ----
    'middleware.ts',
    'src/middleware.ts',
    'src/app/login/page.tsx',
    'src/app/login/login-form.tsx',
    'src/components/auth/auth-card.tsx',
    'src/app/actions/auth.ts',
    'src/lib/auth/session.ts',
    'src/lib/auth/password.ts',
    'src/lib/auth/roles.ts',
    'src/lib/auth/token.ts',
    'src/lib/auth/tokens.ts',
    'src/lib/auth/dev-admin.ts',
    'src/lib/auth/rate-limit.ts',
    'src/lib/security/rate-limit.ts',
    'src/lib/db.ts',
    'src/lib/validation/auth.ts',
    'src/instrumentation.ts',

    # ---- [D] Database schema + seed / account bootstrap  (auth problem) ----
    'prisma/schema.prisma',
    'drizzle.config.ts',
    'prisma/seed.ts', 'prisma/seed.js',
    'scripts/seed.ts', 'scripts/seed.js'
)

# ---------------------------------------------------------------------
# 2) Helpers
# ---------------------------------------------------------------------
 $Sb       = New-Object System.Text.StringBuilder
 $Included = New-Object System.Collections.Generic.List[string]
 $Missing  = New-Object System.Collections.Generic.List[string]

function Add-Line { param([string]$Text) [void]$Sb.AppendLine($Text) }

function Test-FileIsText {
    param([string]$FullPath)
    try {
        $bytes = [System.IO.File]::ReadAllBytes($FullPath)
        if ($bytes.Length -eq 0) { return $true }
        $n = [Math]::Min(8192, $bytes.Length)
        for ($i = 0; $i -lt $n; $i++) { if ($bytes[$i] -eq 0) { return $false } }
        return $true
    } catch { return $false }
}

# ---------------------------------------------------------------------
# 3) Bundle header
# ---------------------------------------------------------------------
Add-Line '################################################################################'
Add-Line '#  MANARAT QURTUBAH - DIAGNOSTIC BUNDLE'
Add-Line '#  Purpose  : diagnosis of (1) UI/Tailwind problem, (2) authentication problem'
Add-Line ("#  Generated: {0} (local) / {1} (UTC)" -f (Get-Date), (Get-Date).ToUniversalTime())
Add-Line ("#  Project  : {0}" -f $Root)
Add-Line ("#  PowerShell: {0}" -f $PSVersionTable.PSVersion.ToString())
Add-Line '#  SECURITY : no .env values are included (variable names only, [REDACTED]).'
Add-Line '#             no passwords are requested or included.'
Add-Line '#  MODE     : read-only collection; no project file was modified.'
Add-Line '################################################################################'
Add-Line ''

# ---------------------------------------------------------------------
# 4) Installed package versions (version strings only, read from
#    node_modules/*/package.json - this reveals e.g. Tailwind v3 vs v4)
# ---------------------------------------------------------------------
Add-Line '===== SECTION: INSTALLED PACKAGE VERSIONS ====='
 $probePackages = @(
    'tailwindcss', '@tailwindcss/postcss', '@tailwindcss/vite',
    'postcss', 'autoprefixer',
    'next', 'react', 'react-dom',
    'next-auth', 'bcryptjs',
    '@prisma/client', 'prisma', 'drizzle-orm',
    'jose', 'jsonwebtoken', 'zod',
    'clsx', 'tailwind-merge'
)
foreach ($pkg in $probePackages) {
    $pjPath = Join-Path $Root ("node_modules/$pkg/package.json")
    if (Test-Path -LiteralPath $pjPath -PathType Leaf) {
        try {
            $pj = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($pjPath))
            Add-Line ("  installed : {0} @ {1}" -f $pj.name, $pj.version)
        } catch {
            Add-Line ("  installed : {0} @ (version unreadable)" -f $pkg)
        }
    } else {
        Add-Line ("  missing   : {0} (not present in node_modules)" -f $pkg)
    }
}
Add-Line '===== END SECTION ====='
Add-Line ''

# ---------------------------------------------------------------------
# 5) Lockfiles present
# ---------------------------------------------------------------------
Add-Line '===== SECTION: LOCKFILES PRESENT ====='
foreach ($lf in @('package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb')) {
    if (Test-Path -LiteralPath (Join-Path $Root $lf) -PathType Leaf) {
        Add-Line ("  " + $lf)
    }
}
Add-Line '===== END SECTION ====='
Add-Line ''

# ---------------------------------------------------------------------
# 6) Environment variable NAMES ONLY (values are NEVER read in)
# ---------------------------------------------------------------------
Add-Line '===== SECTION: ENVIRONMENT VARIABLE NAMES (VALUES [REDACTED]) ====='
Add-Line '#  For safety, values are stripped. Only variable NAMES are listed.'
 $envCandidates = @(
    '.env', '.env.local',
    '.env.development', '.env.development.local',
    '.env.production', '.env.production.local',
    '.env.example'
)
 $foundAnyEnvFile = $false
foreach ($envName in $envCandidates) {
    $envPath = Join-Path $Root $envName
    if (Test-Path -LiteralPath $envPath -PathType Leaf) {
        $foundAnyEnvFile = $true
        Add-Line ''
        Add-Line ("  --- {0} : variable names only ---" -f $envName)
        $envLines  = [System.IO.File]::ReadAllLines($envPath)
        $nameCount = 0
        foreach ($line in $envLines) {
            if ($line -match '^\s*(?:\uFEFF)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=') {
                Add-Line ("      {0}=[REDACTED]" -f $Matches[1])
                $nameCount++
            }
        }
        if ($nameCount -eq 0) { Add-Line '      (no KEY=VALUE lines detected)' }
    }
}
if (-not $foundAnyEnvFile) {
    Add-Line '  (no .env files found in the project root)'
}
Add-Line ''
Add-Line '===== END SECTION ====='
Add-Line ''

# ---------------------------------------------------------------------
# 7) Collect the allowed files (verbatim, with clear FILE/END FILE markers)
# ---------------------------------------------------------------------
foreach ($rel in $Files) {
    $fullPath = Join-Path $Root $rel
    Add-Line ("===== FILE: {0} =====" -f $rel)
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        if (-not (Test-FileIsText -FullPath $fullPath)) {
            Add-Line '[SKIPPED: file appears to be binary - not included]'
            Add-Line '===== END FILE ====='
            Add-Line ''
            Write-Host ("  [BINARY-SKIP] {0}" -f $rel) -ForegroundColor Yellow
            continue
        }
        $content = [System.IO.File]::ReadAllText($fullPath)
        Add-Line ''
        if ($content.Length -gt 0 -and (-not $content.EndsWith("`n"))) {
            [void]$Sb.AppendLine($content)   # add the missing trailing newline only
        } else {
            [void]$Sb.Append($content)
        }
        Add-Line ''
        Add-Line '===== END FILE ====='
        Add-Line ''
        $sizeBytes = (Get-Item -LiteralPath $fullPath).Length
        [void]$Included.Add(("{0}  ({1} bytes)" -f $rel, $sizeBytes))
        Write-Host ("  [COLLECTED]  {0}  ({1} bytes)" -f $rel, $sizeBytes) -ForegroundColor Green
    } else {
        Add-Line '[NOT FOUND - listed in the missing-files section below]'
        Add-Line '===== END FILE ====='
        Add-Line ''
        [void]$Missing.Add($rel)
        Write-Host ("  [NOT FOUND]  {0}" -f $rel) -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------
# 8) Collection summary
# ---------------------------------------------------------------------
Add-Line '===== SECTION: COLLECTION SUMMARY ====='
Add-Line ("  Files collected : {0}" -f $Included.Count)
Add-Line ("  Files missing   : {0}" -f $Missing.Count)
Add-Line ''
Add-Line '  Collected files:'
foreach ($item in $Included) { Add-Line ("    + " + $item) }
if ($Missing.Count -gt 0) {
    Add-Line ''
    Add-Line '  Requested but NOT FOUND (this is itself diagnostic - e.g. a missing'
    Add-Line '  tailwind.config or a missing seed script is an important clue):'
    foreach ($item in $Missing) { Add-Line ("    - " + $item) }
}
Add-Line ''
Add-Line '===== END SECTION ====='
Add-Line ''
Add-Line '################################################################################'
Add-Line '#  END OF DIAGNOSTIC BUNDLE'
Add-Line '################################################################################'

# ---------------------------------------------------------------------
# 9) Write the bundle (UTF-8, no BOM) and report the result
# ---------------------------------------------------------------------
 $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputPath, $Sb.ToString(), $utf8NoBom)

 $bundleSize = (Get-Item -LiteralPath $OutputPath).Length
Write-Host ''
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ("  DONE. Collected {0} file(s); {1} requested path(s) not found." -f $Included.Count, $Missing.Count)
Write-Host ("  Bundle saved to: {0}" -f $OutputPath)
Write-Host ("  Bundle size    : {0:N0} bytes" -f $bundleSize)
Write-Host '  No project file was modified. No .env value and no password was included.' -ForegroundColor Cyan
Write-Host '======================================================================' -ForegroundColor Cyan