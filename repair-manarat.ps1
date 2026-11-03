# =====================================================================
#  MANARAT QURTUBAH - REPAIR SCRIPT (repair stage, authorized)
# =====================================================================
#  FIXES
#    (1) Broken UI: restores the full Tailwind v4 design tokens into
#        src/app/globals.css from the existing globals.css.bak backup,
#        with two safety transforms:
#          - removes the undefined var(--font-cairo) reference so text
#            renders with "Segoe UI" instead of falling back to serif;
#          - keeps @import "tw-animate-css" if the package installs,
#            otherwise swaps it for @plugin "tailwindcss-animate".
#    (2) Broken login: applies the Prisma schema (npx prisma db push)
#        then runs node prisma/seed.js which (re)creates the five role
#        accounts idempotently (no duplicates, passwords reset to the
#        documented development credentials).
#    (3) Adds "db:seed" npm script + "prisma.seed" config to package.json
#        so `npm run db:seed` / `npx prisma db seed` work from now on.
#
#  SAFETY
#    - Nothing is deleted. Every file it touches is backed up first
#      with a timestamp suffix: *.pre-repair-<timestamp>.bak
#    - package.json changes are JSON-validated; on failure the backup
#      is restored automatically.
#    - The seed script is idempotent (safe to re-run any time).
#
#  RUN (from the project root, dev server STOPPED):
#    powershell -NoProfile -ExecutionPolicy Bypass -File .\repair-manarat.ps1
# =====================================================================

 $ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---------------------------------------------------------------------
# 0) Locate project root
# ---------------------------------------------------------------------
 $Root = (Get-Location).Path
if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json') -PathType Leaf)) {
    Write-Host ''
    Write-Host 'ERROR: package.json not found in the current directory:' -ForegroundColor Red
    Write-Host "       $Root"
    Write-Host 'Run this script from the project root:  cd D:\DevCore\Teachers-platform'
    exit 1
}

 $CssPath     = Join-Path $Root 'src\app\globals.css'
 $CssBakPath  = Join-Path $Root 'src\app\globals.css.bak'
 $PkgPath     = Join-Path $Root 'package.json'
 $SeedPath    = Join-Path $Root 'prisma\seed.js'
 $SchemaPath  = Join-Path $Root 'prisma\schema.prisma'
 $Stamp       = Get-Date -Format 'yyyyMMdd-HHmmss'

 $script:PushOk = $false
 $script:SeedOk = $false
 $script:CssOk  = $false
 $script:PkgOk  = $false

function Step([int]$Number, [string]$Title) {
    Write-Host ''
    Write-Host ("=== STEP {0}: {1} ===" -f $Number, $Title) -ForegroundColor Cyan
}
function Ok([string]$Msg)   { Write-Host ("  [OK]     " + $Msg) -ForegroundColor Green }
function Warn([string]$Msg) { Write-Host ("  [WARN]   " + $Msg) -ForegroundColor Yellow }
function Fail([string]$Msg) { Write-Host ("  [FAIL]   " + $Msg) -ForegroundColor Red }

function Backup-File([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $dest = "$Path.pre-repair-$Stamp.bak"
        Copy-Item -LiteralPath $Path -Destination $dest -Force
        Write-Host ("  [BACKUP] {0}  ->  {1}" -f $Path, $dest) -ForegroundColor DarkCyan
        return $dest
    }
    return $null
}

Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ' MANARAT QURTUBAH - REPAIR SCRIPT'                                       -ForegroundColor Cyan
Write-Host "   Project root : $Root"
Write-Host '   Will fix     : (1) design tokens in globals.css  (2) seed role accounts'
Write-Host '   Safety       : timestamped backups, no deletions, JSON validation'
Write-Host '======================================================================' -ForegroundColor Cyan

# ---------------------------------------------------------------------
# STEP 0 - Preflight checks
# ---------------------------------------------------------------------
Step 0 'Preflight checks'
 $abort = $false

if (-not (Test-Path -LiteralPath $CssBakPath -PathType Leaf)) {
    Fail "missing $CssBakPath - cannot restore the design tokens"; $abort = $true
} else { Ok 'globals.css.bak (design-token backup) found' }

if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) {
    Fail "missing $SchemaPath - cannot apply the database schema"; $abort = $true
} else { Ok 'prisma/schema.prisma found' }

if (-not (Test-Path -LiteralPath $SeedPath -PathType Leaf)) {
    Fail "missing $SeedPath - cannot seed the role accounts"; $abort = $true
} else { Ok 'prisma/seed.js found' }

if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules') -PathType Container)) {
    Fail 'node_modules not found - run "npm install" first, then re-run this script'
    $abort = $true
} else { Ok 'node_modules found' }

 $nodeProcs = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcs) {
    Warn 'a node process is running - if that is your dev server (npm run dev),'
    Warn 'stop it with Ctrl+C first so the SQLite database is not locked.'
}

try { $null = & node --version; if ($LASTEXITCODE -ne 0) { throw 'node check failed' }; Ok 'node is available' }
catch { Fail 'node is not available in PATH'; $abort = $true }

if ($abort) {
    Write-Host ''
    Fail 'preflight failed - nothing was modified. Fix the items above and re-run.'
    exit 1
}

# ---------------------------------------------------------------------
# STEP 1 - Backups
# ---------------------------------------------------------------------
Step 1 'Backing up files that will be modified'
 $pkgBackup = Backup-File $PkgPath
Backup-File $CssPath | Out-Null
Ok 'backups done (nothing will be deleted)'

# ---------------------------------------------------------------------
# STEP 2 - Install tw-animate-css (the v4 animation package the .bak expects)
# ---------------------------------------------------------------------
Step 2 'Installing tw-animate-css via npm'
 $npmOk = $false
try {
    & npm install tw-animate-css --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -eq 0) { $npmOk = $true; Ok 'tw-animate-css installed' }
    else { Fail "npm install failed (exit code $LASTEXITCODE) - will use the @plugin tailwindcss-animate fallback instead" }
} catch {
    Fail ("npm is not usable: " + $_.Exception.Message + " - will use the @plugin fallback instead")
}

# ---------------------------------------------------------------------
# STEP 3 - Restore the design tokens into src/app/globals.css
# ---------------------------------------------------------------------
Step 3 'Restoring design tokens into src/app/globals.css'
try {
    $css = [System.IO.File]::ReadAllText($CssBakPath)

    # Safety transform 1: the Cairo font variable is never defined in
    # layout.tsx. A var() referencing a missing custom property makes the
    # whole font-family declaration invalid (browser-serif fallback).
    $before = $css
    $css = $css.Replace('var(--font-cairo), ', '')
    if ($css -ne $before) { Ok 'removed undefined var(--font-cairo) -> falls back to Segoe UI' }

    # Safety transform 2: animation package handling.
    if ($npmOk) {
        Ok 'keeping @import "tw-animate-css" (package is now installed)'
    } else {
        $before = $css
        $css = $css.Replace('@import "tw-animate-css";', '@plugin "tailwindcss-animate";')
        if ($css -ne $before) { Ok 'swapped tw-animate-css import for @plugin "tailwindcss-animate"' }
        else { Warn 'tw-animate-css import not found in .bak - no swap needed' }
    }

    [System.IO.File]::WriteAllText($CssPath, $css, (New-Object System.Text.UTF8Encoding($false)))

    if ($css.Contains('@theme inline') -and $css.Contains('--color-primary') -and $css.Contains('--background:')) {
        $script:CssOk = $true
        Ok ('globals.css restored - design tokens verified ({0} chars)' -f $css.Length)
    } else {
        Fail 'restored file failed verification - check its contents'
    }
} catch {
    Fail ('could not restore globals.css: ' + $_.Exception.Message)
}

# ---------------------------------------------------------------------
# STEP 4 - Apply the database schema
# ---------------------------------------------------------------------
Step 4 'Applying the database schema (npx prisma db push)'
try {
    & npx prisma db push
    if ($LASTEXITCODE -eq 0) { $script:PushOk = $true; Ok 'database schema is up to date' }
    else { Fail "prisma db push failed (exit code $LASTEXITCODE)" }
} catch {
    Fail ('prisma db push could not run: ' + $_.Exception.Message)
}

# ---------------------------------------------------------------------
# STEP 5 - Seed the five role accounts
# ---------------------------------------------------------------------
Step 5 'Seeding the five role accounts (node prisma/seed.js)'
if ($script:PushOk) {
    try {
        & node $SeedPath
        if ($LASTEXITCODE -eq 0) { $script:SeedOk = $true; Ok 'seed completed - accounts ready' }
        else { Fail "seed failed (exit code $LASTEXITCODE) - see the output above" }
    } catch {
        Fail ('seed could not run: ' + $_.Exception.Message)
    }
} else {
    Fail 'skipped the seed because the schema step failed'
}

# ---------------------------------------------------------------------
# STEP 6 - Register the seed in package.json (guarded + JSON-validated)
# ---------------------------------------------------------------------
Step 6 'Adding db:seed / prisma.seed entries to package.json'
try {
    $raw = [System.IO.File]::ReadAllText($PkgPath)
    $changed = $false

    if ($raw.Contains('"db:seed"')) {
        Ok '"db:seed" already present - skipped'
    } else {
        $anchor = '    "db:deploy": "prisma migrate deploy",'
        if ($raw.Contains($anchor)) {
            $raw = $raw.Replace($anchor, $anchor + "`r`n" + '    "db:seed": "node prisma/seed.js",')
            $changed = $true
            Ok 'added "db:seed" npm script'
        } else {
            Warn 'could not find the scripts anchor - add "db:seed": "node prisma/seed.js" manually'
        }
    }

    if ($raw.Contains('"seed": "node prisma/seed.js"')) {
        Ok '"prisma.seed" already present - skipped'
    } else {
        $anchor2 = '  "devDependencies": {'
        if ($raw.Contains($anchor2)) {
            $insert = '  "prisma": {' + "`r`n" + '    "seed": "node prisma/seed.js"' + "`r`n" + '  },' + "`r`n"
            $raw = $raw.Replace($anchor2, $insert + $anchor2)
            $changed = $true
            Ok 'added "prisma.seed" config'
        } else {
            Warn 'could not find the devDependencies anchor - add "prisma": { "seed": "node prisma/seed.js" } manually'
        }
    }

    if ($changed) {
        $null = $raw | ConvertFrom-Json   # throws if the JSON is broken
        [System.IO.File]::WriteAllText($PkgPath, $raw, (New-Object System.Text.UTF8Encoding($false)))
        $script:PkgOk = $true
        Ok 'package.json updated and JSON-validated'
    }
} catch {
    Fail ('package.json update failed: ' + $_.Exception.Message)
    if ($pkgBackup -and (Test-Path -LiteralPath $pkgBackup)) {
        Copy-Item -LiteralPath $pkgBackup -Destination $PkgPath -Force
        Warn 'package.json restored from backup'
    }
}

# ---------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------
Write-Host ''
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ' REPAIR SUMMARY'                                                         -ForegroundColor Cyan
Write-Host ("   UI design tokens restored : {0}" -f $(if ($script:CssOk) { 'YES' } else { 'NO - see [FAIL] above' }))
Write-Host ("   Database schema applied  : {0}" -f $(if ($script:PushOk) { 'YES' } else { 'NO - see [FAIL] above' }))
Write-Host ("   Role accounts seeded      : {0}" -f $(if ($script:SeedOk) { 'YES' } else { 'NO - see [FAIL] above' }))
Write-Host ("   package.json updated      : {0}" -f $(if ($script:PkgOk) { 'YES' } else { 'NO/unchanged' }))
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host ' WHAT TO DO NOW:' -ForegroundColor Cyan
Write-Host '   1. Start the dev server:        npm run dev'
Write-Host '   2. Open http://localhost:3000/login and hard-refresh (Ctrl+Shift+R):'
Write-Host '      you should see the styled login card (blue brand, card, spacing).'
Write-Host '   3. Sign in with each role account (the credentials documented in'
Write-Host '      prisma/seed.js - the seed printed its own summary table above).'
Write-Host '   4. From now on you can reseed anytime with:  npm run db:seed'
Write-Host ''
Write-Host ' If ANYTHING still looks unstyled or a login fails, send me:'
Write-Host '   - the full output of this script, and/or'
Write-Host '   - the terminal output of npm run dev at the moment of the failure.'
Write-Host '======================================================================' -ForegroundColor Cyan