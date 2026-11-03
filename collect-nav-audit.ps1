# =====================================================================
#  MANARAT QURTUBAH - SIDEBAR / NAVIGATION AUDIT COLLECTOR (READ-ONLY)
# =====================================================================
#  PURPOSE
#    One-shot collection of everything needed to audit the sidebar and
#    activate every genuinely-implemented module (batch 1 of 2):
#      (1) full source tree of src/ (routes, pages, actions, components)
#      (2) the navigation config + sidebar/topbar/mobile-nav components
#      (3) every occurrence of the Coming-Soon flag ("قريباً" / comingSoon)
#      (4) every internal href= target (broken-link check)
#      (5) role-navigation wiring (roles.ts, navIdsForRole) + session guard
#    Output: ONE text file in the project root:
#      manarat-nav-audit.txt
#
#  SAFETY GUARANTEES
#    - 100% READ-ONLY. Never edits, moves, renames or deletes any project
#      file. The only file it creates is the output bundle.
#    - Scans ONLY src\ (plus lists tests\ names). NEVER scans node_modules,
#      .next, .git, dist, build, coverage or any cache.
#    - No .env values, no passwords, no secrets are read or included.
#
#  HOW TO RUN (from the project root D:\DevCore\Teachers-platform)
#    powershell -NoProfile -ExecutionPolicy Bypass -File .\collect-nav-audit.ps1
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
if (-not (Test-Path -LiteralPath (Join-Path $Root 'src') -PathType Container)) {
    Write-Host ''
    Write-Host 'ERROR: src\ folder was not found in the current directory.' -ForegroundColor Red
    exit 1
}

 $OutputPath = Join-Path $Root 'manarat-nav-audit.txt'

Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ' MANARAT QURTUBAH - SIDEBAR / NAVIGATION AUDIT COLLECTOR (READ-ONLY)'    -ForegroundColor Cyan
Write-Host "   Project root : $Root"
Write-Host "   Output file  : $OutputPath"
Write-Host '======================================================================' -ForegroundColor Cyan

# ---------------------------------------------------------------------
# 1) Helpers
# ---------------------------------------------------------------------
 $Sb = New-Object System.Text.StringBuilder
function Add-Line { param([string]$Text) [void]$Sb.AppendLine($Text) }

# Arabic literals are built from Unicode code points so the patterns stay
# correct no matter which encoding PowerShell uses to read this script.
function New-ArabicString { param([int[]]$CodePoints)
    $b = New-Object System.Text.StringBuilder
    foreach ($cp in $CodePoints) { [void]$b.Append([char]$cp) }
    return $b.ToString()
}
 $SOON_TANWEEN = New-ArabicString @(0x0642,0x0631,0x064A,0x0628,0x0627,0x064B)  # "qareeban" with tanween
 $SOON_PLAIN   = New-ArabicString @(0x0642,0x0631,0x064A,0x0628,0x0627)          # "qareeba" without tanween
 $MOCK_LABEL   = New-ArabicString @(0x0628,0x064A,0x0627,0x0646,0x0627,0x062A,0x0020,0x062A,0x062C,0x0631,0x064A,0x0628,0x064A,0x0629)  # "mock data" label

function Read-LinesSafe {
    # Returns string[] for text files, $null for binary/huge/unreadable ones.
    param([string]$FullPath)
    try {
        $bytes = [System.IO.File]::ReadAllBytes($FullPath)
        if ($bytes.Length -gt 1048576) { return $null }          # skip files > 1 MB
        $n = [Math]::Min(8192, $bytes.Length)
        for ($i = 0; $i -lt $n; $i++) { if ($bytes[$i] -eq 0) { return $null } }  # binary
        return [System.IO.File]::ReadAllLines($FullPath)
    } catch { return $null }
}

# ---------------------------------------------------------------------
# 2) Load the whole src\ tree into memory (text files only)
# ---------------------------------------------------------------------
 $FileLines = @{}          # relative path -> string[] (or $null for binary)
 $AllRel    = New-Object System.Collections.Generic.List[string]

 $srcRoot = Join-Path $Root 'src'
 $srcFiles = Get-ChildItem -LiteralPath $srcRoot -Recurse -File | Sort-Object FullName
foreach ($f in $srcFiles) {
    $rel = $f.FullName.Substring($Root.Length).TrimStart('\','/').Replace('\','/')
    $AllRel.Add($rel)
    $FileLines[$rel] = Read-LinesSafe -FullPath $f.FullName
}

# tests\ tree: names only (no content), keeps the bundle small
 $testsRel = New-Object System.Collections.Generic.List[string]
 $testsRoot = Join-Path $Root 'tests'
if (Test-Path -LiteralPath $testsRoot -PathType Container) {
    foreach ($f in (Get-ChildItem -LiteralPath $testsRoot -Recurse -File | Sort-Object FullName)) {
        [void]$testsRel.Add($f.FullName.Substring($Root.Length).TrimStart('\','/').Replace('\','/'))
    }
}

# ---------------------------------------------------------------------
# 3) Bundle header
# ---------------------------------------------------------------------
Add-Line '################################################################################'
Add-Line '#  MANARAT QURTUBAH - SIDEBAR / NAVIGATION AUDIT BUNDLE'
Add-Line '#  Purpose  : sidebar audit + activation of implemented modules (batch 1)'
Add-Line ("#  Generated: {0} (local) / {1} (UTC)" -f (Get-Date), (Get-Date).ToUniversalTime())
Add-Line ("#  Project  : {0}" -f $Root)
Add-Line ("#  PowerShell: {0}" -f $PSVersionTable.PSVersion.ToString())
Add-Line '#  SECURITY : read-only; no .env values, no passwords, no secrets.'
Add-Line '################################################################################'
Add-Line ''

# ---------------------------------------------------------------------
# 4) SECTION: SOURCE TREE (src)
# ---------------------------------------------------------------------
Add-Line '===== SECTION: SOURCE TREE (src) ====='
 $textCount = 0; $binCount = 0
foreach ($rel in $AllRel) {
    $lines = $FileLines[$rel]
    if ($null -eq $lines) {
        Add-Line ("  {0}  (binary or >1MB - content skipped)" -f $rel)
        $binCount++
    } else {
        Add-Line ("  {0}  (lines={1})" -f $rel, $lines.Count)
        $textCount++
    }
}
Add-Line ''
Add-Line ("  Text files: {0}   Binary/skipped: {1}" -f $textCount, $binCount)
if ($testsRel.Count -gt 0) {
    Add-Line ''
    Add-Line '  tests\ tree (names only):'
    foreach ($t in $testsRel) { Add-Line ("    " + $t) }
}
Add-Line '===== END SECTION ====='
Add-Line ''

# ---------------------------------------------------------------------
# 5) SECTION: ROUTE INVENTORY (src/app/**/page.*)
# ---------------------------------------------------------------------
Add-Line '===== SECTION: ROUTE INVENTORY (src/app/**/page.*) ====='
 $routeCount = 0
foreach ($rel in $AllRel) {
    if ($rel -match '^src/app/(.*)/page\.(tsx|ts|jsx|js)$' -or $rel -eq 'src/app/page.tsx') {
        $route = $rel -replace '^src/app', ''
        $route = $route -replace '/page\.(tsx|ts|jsx|js)$', ''
        if ($route -eq '') { $route = '/' }
        $lines = $FileLines[$rel]
        $lc = 0; if ($null -ne $lines) { $lc = $lines.Count }
        Add-Line ("  {0,-55}  <- {1}  (lines={2})" -f $route, $rel, $lc)
        $routeCount++
    }
}
Add-Line ("  Total page files: {0}" -f $routeCount)
Add-Line '===== END SECTION ====='
Add-Line ''

# ---------------------------------------------------------------------
# 6) FILE DUMPS (verbatim, only those that exist)
# ---------------------------------------------------------------------
 $DumpFiles = @(
    # navigation config (candidates - the real one is one of the first three)
    'src/config/navigation.ts',
    'src/config/navigation.tsx',
    'src/lib/navigation.ts',
    # shared types (NavItem / CurrentUser)
    'src/lib/types.ts',
    # shell components that render the sidebar
    'src/components/layout/sidebar.tsx',
    'src/components/layout/topbar.tsx',
    'src/components/layout/mobile-nav.tsx',
    'src/components/layout/brand-logo.tsx',
    # dashboard quick actions / internal links
    'src/components/dashboard/dashboard-view.tsx',
    'src/components/dashboard/role-dashboard.tsx',
    # role-navigation wiring + session guard
    'src/lib/auth/roles.ts',
    'src/lib/auth/session.ts',
    # route guards (if any)
    'middleware.ts',
    'src/middleware.ts'
)

 $navDumped = $false
foreach ($rel in $DumpFiles) {
    Add-Line ("===== FILE: {0} =====" -f $rel)
    $lines = $null
    if ($FileLines.ContainsKey($rel)) { $lines = $FileLines[$rel] }
    if ($null -ne $lines) {
        Add-Line ''
        foreach ($l in $lines) { Add-Line $l }
        Add-Line ''
        if ($lines -match 'navItems' ) { $navDumped = $true }
        Write-Host ("  [COLLECTED]  {0}  ({1} lines)" -f $rel, $lines.Count) -ForegroundColor Green
    } else {
        Add-Line '[NOT FOUND - listed in the missing-files section below]'
        Write-Host ("  [NOT FOUND]  {0}" -f $rel) -ForegroundColor Yellow
    }
    Add-Line '===== END FILE ====='
    Add-Line ''
}

# ---------------------------------------------------------------------
# 7) Fallback: if the navigation config was not among the candidates,
#    dump up to 3 files that actually define navItems / navIdsForRole.
# ---------------------------------------------------------------------
if (-not $navDumped) {
    Add-Line '===== SECTION: FALLBACK - FILES DEFINING navItems / navIdsForRole ====='
    $found = 0
    foreach ($rel in $AllRel) {
        if ($found -ge 3) { break }
        $lines = $FileLines[$rel]
        if ($null -eq $lines) { continue }
        $hits = @($lines | Select-String -SimpleMatch 'navItems', 'navIdsForRole')
        if ($hits.Count -gt 0 -and $rel -notlike 'src/components/layout/*') {
            Add-Line ''
            Add-Line ("--- FALLBACK FILE: {0} ---" -f $rel)
            foreach ($l in $lines) { Add-Line $l }
            Add-Line ''
            Write-Host ("  [FALLBACK-DUMP] {0}" -f $rel) -ForegroundColor Green
            $found++
        }
    }
    if ($found -eq 0) { Add-Line '  (no file in src defines navItems or navIdsForRole)' }
    Add-Line '===== END SECTION ====='
    Add-Line ''
}

# ---------------------------------------------------------------------
# 8) GREP sections over src\
# ---------------------------------------------------------------------
function Add-GrepSection {
    param(
        [string]$Title,
        [string]$Pattern,          # regex
        [int]$Context = 0,         # extra lines before/after
        [int]$MaxMatches = 250
    )
    Add-Line ("===== SECTION: {0} =====" -f $Title)
    Add-Line ("  Pattern: {0}" -f $Pattern)
    Add-Line ''
    $total = 0
    foreach ($rel in $AllRel) {
        if ($total -ge $MaxMatches) { break }
        $lines = $FileLines[$rel]
        if ($null -eq $lines) { continue }
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($total -ge $MaxMatches) { break }
            if ($lines[$i] -match $Pattern) {
                if ($Context -gt 0) {
                    $start = [Math]::Max(0, $i - $Context)
                    $end   = [Math]::Min($lines.Count - 1, $i + $Context)
                    for ($j = $start; $j -le $end; $j++) {
                        $mark = ' '; if ($j -eq $i) { $mark = '>' }
                        Add-Line ("  {0} {1}:{2}: {3}" -f $mark, $rel, ($j + 1), $lines[$j].TrimEnd())
                    }
                    Add-Line '  ---'
                } else {
                    Add-Line ("  {0}:{1}: {2}" -f $rel, ($i + 1), $lines[$i].TrimEnd())
                }
                $total++
            }
        }
    }
    if ($total -ge $MaxMatches) { Add-Line '  (MATCH LIMIT REACHED - section truncated)' }
    if ($total -eq 0) { Add-Line '  (no matches)' }
    Add-Line ''
    Add-Line ("  Matches: {0}" -f $total)
    Add-Line '===== END SECTION ====='
    Add-Line ''
    Write-Host ("  [GREP] {0} : {1} match(es)" -f $Title, $total) -ForegroundColor Green
}

# 8a) every Coming-Soon flag / label, with context so the item shape is visible
 $soonRegex = '(?i)(' + [regex]::Escape($SOON_TANWEEN) + '|' + [regex]::Escape($SOON_PLAIN) + '|coming\s*[-_]?soon|comingsoon|\bsoon\b)'
Add-GrepSection -Title 'GREP 1: COMING-SOON FLAGS AND LABELS' -Pattern $soonRegex -Context 2 -MaxMatches 250

# 8b) every internal href target (broken-link + duplicate-route check)
Add-GrepSection -Title 'GREP 2: INTERNAL HREF TARGETS' -Pattern 'href\s*=' -Context 0 -MaxMatches 400

# 8c) role-navigation wiring
Add-GrepSection -Title 'GREP 3: ROLE-NAV WIRING (navIdsForRole / NAV_ROLES / allowedModuleIds)' -Pattern 'navIdsForRole|NAV_ROLES|allowedModuleIds' -Context 0 -MaxMatches 150

# 8d) mock / placeholder markers (partial-implementation detector)
 $mockRegex = '(?i)(' + [regex]::Escape($MOCK_LABEL) + '|mock|placeholder|TODO|FIXME|not implemented|phase 1)'
Add-GrepSection -Title 'GREP 4: MOCK / PLACEHOLDER / TODO MARKERS' -Pattern $mockRegex -Context 0 -MaxMatches 250

# ---------------------------------------------------------------------
# 9) Collection summary
# ---------------------------------------------------------------------
Add-Line '===== SECTION: COLLECTION SUMMARY ====='
Add-Line ("  Source files scanned : {0}" -f $AllRel.Count)
Add-Line ("  Page files found     : {0}" -f $routeCount)
Add-Line ("  Grep sections        : 4")
Add-Line ''
Add-Line '  Requested dumps that were NOT FOUND (diagnostic by itself):'
 $missingDumps = 0
foreach ($rel in $DumpFiles) {
    $lines = $null
    if ($FileLines.ContainsKey($rel)) { $lines = $FileLines[$rel] }
    if ($null -eq $lines) { Add-Line ("    - " + $rel); $missingDumps++ }
}
if ($missingDumps -eq 0) { Add-Line '    (none - all requested files were collected)' }
Add-Line ''
Add-Line '===== END SECTION ====='
Add-Line ''
Add-Line '################################################################################'
Add-Line '#  END OF NAVIGATION AUDIT BUNDLE'
Add-Line '################################################################################'

# ---------------------------------------------------------------------
# 10) Write the bundle (UTF-8, no BOM) and report the result
# ---------------------------------------------------------------------
 $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputPath, $Sb.ToString(), $utf8NoBom)

 $bundleSize = (Get-Item -LiteralPath $OutputPath).Length
Write-Host ''
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ("  DONE. Scanned {0} src file(s); {1} page route(s); dumps missing: {2}." -f $AllRel.Count, $routeCount, $missingDumps)
Write-Host ("  Bundle saved to: {0}" -f $OutputPath)
Write-Host ("  Bundle size    : {0:N0} bytes" -f $bundleSize)
Write-Host '  READ-ONLY: no project file was modified, nothing was deleted.' -ForegroundColor Cyan
Write-Host '  Next: send manarat-nav-audit.txt back -> batch 2 delivers the fixes.' -ForegroundColor Cyan
Write-Host '======================================================================' -ForegroundColor Cyan