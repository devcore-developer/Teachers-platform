<#
================================================================================
 collect-files.ps1  --  READ-ONLY pre-change snapshot of task files
--------------------------------------------------------------------------------
 Purpose:
   Collect the CURRENT versions of every file involved in the
   "registration links + IT assignment + account recovery" task,
   BEFORE applying the modified files, so nothing is lost or missed.

 What it does (never modifies / moves / deletes any source file):
   1. Copies fixed file lists (groups A/B/C below) into
        _file-audit-<timestamp>\files\<original relative path>
      preserving the folder structure.
   2. Auto-sweeps src\ and prisma\ for related files
      (forgot / reset / register / recovery / token / password / auth /
       it / actions / validation / mail / registration-links ...)
      and copies them as group D, so nothing is missed.
   3. Writes, inside the output folder:
        - INVENTORY-REPORT.md      (what was found / missing, sizes, hashes)
        - manifest.csv             (same info, spreadsheet-friendly)
        - ALL-COLLECTED-FILES.txt  (every collected file concatenated with
                                    clear separators - single review copy)
   4. Zips the whole output folder to file-audit-<timestamp>.zip
      next to the project root (skip with -NoZip).

 Usage (Windows PowerShell 5.1+ or PowerShell 7+):
   cd <project-root>
   powershell -ExecutionPolicy Bypass -File .\collect-files.ps1

 Optional parameters:
   -ProjectRoot "C:\path\to\project"   (default: current folder, then the
                                        folder containing this script)
   -OutputDir   "C:\some\folder"       (default: <ProjectRoot>\_file-audit-<ts>)
   -NoZip                               skip the zip step
================================================================================
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$OutputDir   = "",
    [switch]$NoZip
)

 $ErrorActionPreference = "Stop"

# ----------------------------------------------------------------------------
# 0. Locate the project root
# ----------------------------------------------------------------------------
function Test-ProjectRoot([string]$p) {
    (Test-Path -LiteralPath (Join-Path $p "package.json")) -or
    (Test-Path -LiteralPath (Join-Path $p "src"))
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $cwd = (Get-Location).Path
    if (Test-ProjectRoot $cwd) {
        $ProjectRoot = $cwd
    } elseif ($PSScriptRoot -and (Test-ProjectRoot $PSScriptRoot)) {
        $ProjectRoot = $PSScriptRoot
    } else {
        $ProjectRoot = $cwd
    }
}
if (-not (Test-Path -LiteralPath $ProjectRoot)) {
    Write-Host "[X] Path not found: $ProjectRoot" -ForegroundColor Red
    exit 1
}
 $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\', '/')
if (-not (Test-ProjectRoot $ProjectRoot)) {
    Write-Host "[X] This does not look like the project root:" -ForegroundColor Red
    Write-Host "    $ProjectRoot" -ForegroundColor Red
    Write-Host "    (no package.json and no src folder found there)" -ForegroundColor Red
    Write-Host "    Run it from the project root, or pass -ProjectRoot <path>." -ForegroundColor Yellow
    exit 1
}

 $ts = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $ProjectRoot "_file-audit-$ts"
}
 $filesRoot = Join-Path $OutputDir "files"
New-Item -ItemType Directory -Force -Path $filesRoot | Out-Null

# ----------------------------------------------------------------------------
# 1. Fixed file lists
#    A = modified by the task (will be REPLACED by the new versions)
#    B = brand-new files (MISSING here is EXPECTED - they will be created)
#    C = support / context files (NOT modified, copied for review)
# ----------------------------------------------------------------------------
 $FixedFiles = @(
    # --- A: modified ---
    @{ G="A"; P="src/config/navigation.ts";                        N="sidebar nav: IT coordinator items" },
    @{ G="A"; P="src/lib/auth/roles.ts";                           N="role keys + NAV_ROLES map" },
    @{ G="A"; P="src/app/page.tsx";                                N="home dashboard (role switch)" },
    @{ G="A"; P="src/app/login/page.tsx";                          N="login page (forgot link + banner)" },
    @{ G="A"; P="src/lib/it/service.ts";                           N="IT service: assign + recovery + stats" },
    @{ G="A"; P="src/app/it/assignments/assignments-client.tsx";   N="assignments workspace UI" },
    # --- B: new ---
    @{ G="B"; P="src/app/forgot-password/page.tsx";                N="forgot password page" },
    @{ G="B"; P="src/app/forgot-password/forgot-password-form.tsx"; N="forgot password form" },
    @{ G="B"; P="src/app/reset-password/page.tsx";                 N="reset password page (token states)" },
    @{ G="B"; P="src/app/reset-password/reset-password-form.tsx";  N="reset password form" },
    # --- C: support ---
    @{ G="C"; P="src/app/actions/auth.ts";                         N="auth server actions" },
    @{ G="C"; P="src/app/actions/it.ts";                           N="IT server actions" },
    @{ G="C"; P="src/app/actions/registration-links.ts";           N="registration links actions" },
    @{ G="C"; P="src/lib/validation/it.ts";                        N="IT zod schemas" },
    @{ G="C"; P="src/lib/auth/one-time-tokens.ts";                 N="single-use reset tokens" },
    @{ G="C"; P="src/lib/auth/dev-admin.ts";                       N="dev admin contexts (IT ctx)" },
    @{ G="C"; P="src/lib/auth/session.ts";                         N="session helpers (requireUser)" },
    @{ G="C"; P="src/lib/auth/password.ts";                        N="password hashing" },
    @{ G="C"; P="src/lib/auth/rate-limit.ts";                      N="login rate limiter" },
    @{ G="C"; P="src/lib/auth/token.ts";                           N="token helpers" },
    @{ G="C"; P="src/lib/mail/mailer.ts";                          N="mail provider + reset email" },
    @{ G="C"; P="src/lib/db.ts";                                   N="prisma client singleton" },
    @{ G="C"; P="src/lib/types.ts";                                N="shared types (NavItem)" },
    @{ G="C"; P="src/lib/branding.ts";                             N="public branding resolver" },
    @{ G="C"; P="src/components/auth/auth-card.tsx";               N="shared auth card shell" },
    @{ G="C"; P="src/components/platform/status-badge.tsx";        N="status badge" },
    @{ G="C"; P="src/components/dashboard/it-coordinator-dashboard.tsx"; N="IT dashboard component" },
    @{ G="C"; P="src/app/it/assignments/page.tsx";                 N="assignments page (guard+data)" },
    @{ G="C"; P="src/app/it/recovery/page.tsx";                    N="recovery page" },
    @{ G="C"; P="src/app/it/recovery/recovery-client.tsx";         N="recovery client UI" },
    @{ G="C"; P="src/app/registration-links/page.tsx";             N="registration links page" },
    @{ G="C"; P="src/app/registration-links/link-manager.tsx";     N="registration links manager UI" },
    @{ G="C"; P="src/components/ui/input.tsx";                     N="ui input" },
    @{ G="C"; P="src/components/ui/button.tsx";                    N="ui button" },
    @{ G="C"; P="src/app/supervision/dashboard/section.tsx";       N="supervisor dashboard section" },
    @{ G="C"; P="prisma/schema.prisma";                            N="prisma schema (models)" }
)

# ----------------------------------------------------------------------------
# 2. Collection helpers
# ----------------------------------------------------------------------------
 $records = New-Object System.Collections.Generic.List[object]

function Get-RelPath([string]$absolutePath) {
    $rel = $absolutePath.Substring($ProjectRoot.Length).TrimStart('\', '/')
    return ($rel -replace [regex]::Escape('\'), '/')
}

function Add-FileRecord([string]$Group, [string]$RelPath, [string]$Note) {
    $abs = Join-Path $ProjectRoot $RelPath
    if (Test-Path -LiteralPath $abs -PathType Leaf) {
        $dest = Join-Path $filesRoot ($RelPath -replace '/', [IO.Path]::DirectorySeparatorChar)
        $destParent = Split-Path -Parent $dest
        if ($destParent -and -not (Test-Path -LiteralPath $destParent)) {
            New-Item -ItemType Directory -Force -Path $destParent | Out-Null
        }
        Copy-Item -LiteralPath $abs -Destination $dest -Force

        $size  = (Get-Item -LiteralPath $abs).Length
        $lines = 0
        try { $lines = [System.IO.File]::ReadAllLines($abs).Length } catch { $lines = -1 }
        $sha = ""
        try { $sha = (Get-FileHash -LiteralPath $abs -Algorithm SHA256).Hash.Substring(0, 16) } catch { $sha = "n/a" }

        $records.Add([pscustomobject]@{
            Group = $Group; RelPath = $RelPath; Note = $Note
            Status = "FOUND"; SizeBytes = $size; Lines = $lines; Sha16 = $sha
        })
        return $true
    } else {
        $records.Add([pscustomobject]@{
            Group = $Group; RelPath = $RelPath; Note = $Note
            Status = "MISSING"; SizeBytes = 0; Lines = 0; Sha16 = ""
        })
        return $false
    }
}

Write-Host ""
Write-Host "Collecting files from: $ProjectRoot" -ForegroundColor Cyan
Write-Host "Output folder        : $OutputDir"
Write-Host ""

foreach ($f in $FixedFiles) {
    [void](Add-FileRecord -Group $f.G -RelPath $f.P -Note $f.N)
}

# ----------------------------------------------------------------------------
# 3. Auto-sweep for related files (group D) - so nothing is missed
# ----------------------------------------------------------------------------
 $knownRel = @{}
foreach ($r in $records) { $knownRel[$r.RelPath.ToLowerInvariant()] = $true }
 $swept    = @{}
 $dCount   = 0

function Add-SweepFile([System.IO.FileInfo]$fi) {
    if ($script:dCount -ge 400) { return }   # safety cap
    $rel = Get-RelPath $fi.FullName
    $key = $rel.ToLowerInvariant()
    if ($knownRel.ContainsKey($key)) { return }
    if ($swept.ContainsKey($key))    { return }
    if ($fi.Length -gt 5MB)          { return }
    if ($fi.Name -like "*.log" -or $fi.Name -like "*.tsbuildinfo") { return }
    $swept[$key] = $true
    if (Add-FileRecord -Group "D" -RelPath $rel -Note "discovered by auto-sweep") {
        $script:dCount++
    }
}

# 3a. whole relevant directories
 $sweepDirs = @(
    "src/app/it",
    "src/app/actions",
    "src/app/registration-links",
    "src/lib/auth",
    "src/lib/validation",
    "src/lib/mail"
)
foreach ($d in $sweepDirs) {
    $absD = Join-Path $ProjectRoot $d
    if (Test-Path -LiteralPath $absD) {
        Get-ChildItem -LiteralPath $absD -Recurse -File -Force |
            ForEach-Object { Add-SweepFile $_ }
    }
}

# 3b. prisma: schema + migration sql
 $prismaDir = Join-Path $ProjectRoot "prisma"
if (Test-Path -LiteralPath $prismaDir) {
    Get-ChildItem -LiteralPath $prismaDir -Recurse -File -Force |
        Where-Object { $_.Extension -in @(".prisma", ".sql") } |
        ForEach-Object { Add-SweepFile $_ }
}

# 3c. name-pattern sweep across all of src
 $namePatterns = @(
    "*forgot*", "*reset*", "*register*", "*recovery*", "*one-time*",
    "*mailer*", "*middleware*", "*password*", "*rate-limit*", "*token*",
    "*session*", "*auth*", "*branding*", "*status-badge*"
)
 $srcDir = Join-Path $ProjectRoot "src"
if (Test-Path -LiteralPath $srcDir) {
    Get-ChildItem -LiteralPath $srcDir -Recurse -File -Force |
        Where-Object {
            $n = $_.Name.ToLowerInvariant()
            $hit = $false
            foreach ($p in $namePatterns) {
                if ($n -like $p) { $hit = $true; break }
            }
            $hit
        } |
        ForEach-Object { Add-SweepFile $_ }
}

# ----------------------------------------------------------------------------
# 4. Manifest + report + single combined review file
# ----------------------------------------------------------------------------
 $manifestPath = Join-Path $OutputDir "manifest.csv"
 $records |
    Select-Object Group, RelPath, Status, SizeBytes, Lines, Sha16, Note |
    Sort-Object Group, RelPath |
    Export-Csv -NoTypeInformation -Encoding UTF8 -Path $manifestPath

 $found = @($records | Where-Object { $_.Status -eq "FOUND" })
 $missing = @($records | Where-Object { $_.Status -eq "MISSING" })
 $totalBytes = ($found | Measure-Object -Property SizeBytes -Sum).Sum
if (-not $totalBytes) { $totalBytes = 0 }
 $totalKB = [Math]::Round($totalBytes / 1KB, 1)

# ---- INVENTORY-REPORT.md ----
 $sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# File Collection Report (pre-change snapshot)")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("- Generated : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$sb.AppendLine("- Project   : $ProjectRoot")
[void]$sb.AppendLine("- Output    : $OutputDir")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Summary")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| Group | Meaning | Entries | Found | Missing |")
[void]$sb.AppendLine("|---|---|---|---|---|")
foreach ($g in @("A", "B", "C", "D")) {
    $gAll  = @($records | Where-Object { $_.Group -eq $g })
    $gFnd  = @($gAll | Where-Object { $_.Status -eq "FOUND" }).Count
    $gMis  = @($gAll | Where-Object { $_.Status -eq "MISSING" }).Count
    $meaning = switch ($g) {
        "A" { "modified by the task (will be replaced)" }
        "B" { "brand-new files (missing here is EXPECTED)" }
        "C" { "support files (context, not modified)" }
        "D" { "discovered by auto-sweep (copied too)" }
    }
    [void]$sb.AppendLine("| $g | $meaning | $($gAll.Count) | $gFnd | $gMis |")
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Copied: **$($found.Count) files** ($totalKB KB) into ``files\`` - original folder structure preserved.")
[void]$sb.AppendLine("")

 $sectionTitles = @{
    "A" = "## A - Files MODIFIED by the task (will be replaced by the new versions)"
    "B" = "## B - NEW files (MISSING here is EXPECTED - they will be created by the fix)"
    "C" = "## C - Support files (context only, NOT modified)"
    "D" = "## D - Discovered related files (auto-sweep, copied for completeness)"
}
foreach ($g in @("A", "B", "C", "D")) {
    $gRows = @($records | Where-Object { $_.Group -eq $g } | Sort-Object RelPath)
    if ($gRows.Count -eq 0) { continue }
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine($sectionTitles[$g])
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("| # | Path | Status | Size | Lines | Note |")
    [void]$sb.AppendLine("|---|---|---|---|---|---|")
    $i = 1
    foreach ($r in $gRows) {
        $sizeTxt = if ($r.Status -eq "FOUND") { "$([Math]::Round($r.SizeBytes / 1KB, 1)) KB" } else { "-" }
        $linesTxt = if ($r.Status -eq "FOUND" -and $r.Lines -ge 0) { "$($r.Lines)" } else { "-" }
        $statusTxt = if ($r.Status -eq "FOUND") { "[OK]" } else { "[MISSING]" }
        [void]$sb.AppendLine("| $($i) | ``$($r.RelPath)`` | $statusTxt | $sizeTxt | $linesTxt | $($r.Note) |")
        $i++
    }
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Next steps")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("1. Keep this folder (or the zip) as your backup of the CURRENT originals.")
[void]$sb.AppendLine("2. Apply the replacement files that were sent to you (group A gets replaced,")
[void]$sb.AppendLine("   group B files are created new).")
[void]$sb.AppendLine("3. Re-run this script afterwards to snapshot the new state and compare.")
[void]$sb.AppendLine("")
 $reportPath = Join-Path $OutputDir "INVENTORY-REPORT.md"
[System.IO.File]::WriteAllText($reportPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))

# ---- ALL-COLLECTED-FILES.txt ----
 $cb = New-Object System.Text.StringBuilder
 $bar = "=" * 80
[void]$cb.AppendLine($bar)
[void]$cb.AppendLine(" ALL-COLLECTED-FILES.txt - concatenation of every collected file")
[void]$cb.AppendLine(" Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$cb.AppendLine(" Project  : $ProjectRoot")
[void]$cb.AppendLine(" Files    : $($found.Count)")
[void]$cb.AppendLine(" Purpose  : single-file review copy; separators mark file boundaries.")
[void]$cb.AppendLine($bar)
[void]$cb.AppendLine("")
 $n = 0
foreach ($r in ($records | Where-Object { $_.Status -eq "FOUND" })) {
    $n++
    [void]$cb.AppendLine("-" * 80)
    [void]$cb.AppendLine("FILE $n/$($found.Count): $($r.RelPath)   [group $($r.Group), $($r.Lines) lines]")
    [void]$cb.AppendLine("-" * 80)
    try {
        $content = [System.IO.File]::ReadAllText((Join-Path $ProjectRoot $r.RelPath))
        [void]$cb.AppendLine($content)
        if (-not $content.EndsWith("`n")) { [void]$cb.AppendLine("") }
    } catch {
        [void]$cb.AppendLine("(content could not be read: $($_.Exception.Message))")
    }
}
 $combinedPath = Join-Path $OutputDir "ALL-COLLECTED-FILES.txt"
[System.IO.File]::WriteAllText($combinedPath, $cb.ToString(), (New-Object System.Text.UTF8Encoding($true)))

# ----------------------------------------------------------------------------
# 5. Zip (optional)
# ----------------------------------------------------------------------------
 $zipPath = ""
if (-not $NoZip) {
    $zipPath = Join-Path $ProjectRoot "file-audit-$ts.zip"
    try {
        Compress-Archive -Path (Join-Path $OutputDir "*") -DestinationPath $zipPath -Force
    } catch {
        Write-Host "[!] Zip failed ($($_.Exception.Message)) - the output folder is still complete." -ForegroundColor Yellow
        $zipPath = ""
    }
}

# ----------------------------------------------------------------------------
# 6. Console summary
# ----------------------------------------------------------------------------
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host " File collection finished (READ-ONLY run - sources untouched)" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host " Found & copied      : $($found.Count) files ($totalKB KB)"
Write-Host " Missing (expected)  : $($missing.Count)"
foreach ($g in @("A", "B", "C", "D")) {
    $gAll = @($records | Where-Object { $_.Group -eq $g })
    $gFnd = @($gAll | Where-Object { $_.Status -eq "FOUND" }).Count
    $gMis = @($gAll | Where-Object { $_.Status -eq "MISSING" }).Count
    Write-Host ("   group {0}: {1} entries -> {2} found, {3} missing" -f $g, $gAll.Count, $gFnd, $gMis)
}
Write-Host ""
Write-Host " Output folder       : $OutputDir"
if ($zipPath) { Write-Host " Zip                 : $zipPath" }
Write-Host " Report              : INVENTORY-REPORT.md  +  manifest.csv"
Write-Host " Review copy         : ALL-COLLECTED-FILES.txt"
Write-Host ""
Write-Host " Tip: '_file-audit-*' and 'file-audit-*.zip' are backups - safe to"
Write-Host "      delete after the fix, or add them to .gitignore." -ForegroundColor DarkGray
Write-Host ""

if ($env:OS -eq "Windows_NT") {
    try { Invoke-Item -LiteralPath $OutputDir } catch { }
}