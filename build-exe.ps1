# Builds DesktopBroom.exe from desksweep.js using Node's built-in Single
# Executable Application (SEA) feature. Requires Node 20+.
#
#   .\build-exe.ps1                 # x64 build (default), honest metadata + icon
#   .\build-exe.ps1 -Sign           # also self-sign (see sign.ps1)
#
# STEP ORDER MATTERS (matches Node's official Windows SEA docs):
#   copy node.exe -> strip signature -> rcedit metadata -> inject blob.
# Why: the copied node.exe ships Authenticode-signed. That signature is invalid
# once we modify the file ("signature seems corrupted") and, left in place, both
# (a) trips antivirus - a BROKEN signature is worse than none - and (b) makes
# rcedit hang for minutes as it tries to relocate the cert overlay. We also run
# rcedit BEFORE injecting the blob: on the clean node.exe rcedit finishes in <1s,
# but on the 81 MB post-inject binary it stalls. Honest metadata also removes the
# "binary claiming to be node.exe" masquerade pattern that antivirus flags.

param(
  [switch]$Sign,           # self-sign the exe after building (see sign.ps1)
  [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Product   = "Desktop Broom"
$ExeName   = "DesktopBroom.exe"
$Company   = "Desktop Broom"
$Copyright = "(c) 2026 Desktop Broom. MIT License."
$FileVer   = "$Version.0"
$Fuse      = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"

Write-Host "1/6  Generating icon..."
node make-icon.js

Write-Host "2/6  Building SEA blob from desksweep.js..."
node --experimental-sea-config sea-config.json

Write-Host "3/6  Copying node.exe -> $ExeName, then stripping its signature..."
Copy-Item (Get-Command node).Source ".\$ExeName" -Force
node strip-signature.js "$ExeName"

Write-Host "4/6  Stamping honest metadata + icon (rcedit, on clean exe = fast)..."
$rcedit = ".\rcedit-x64.exe"
if (-not (Test-Path $rcedit)) {
  Write-Host "     downloading rcedit tool..."
  Invoke-WebRequest -Uri "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe" -OutFile $rcedit -UseBasicParsing
}
& $rcedit "$ExeName" `
  --set-icon ".\icon.ico" `
  --set-version-string "ProductName"      "$Product" `
  --set-version-string "FileDescription"  "$Product - safe, undoable desktop organizer" `
  --set-version-string "CompanyName"      "$Company" `
  --set-version-string "LegalCopyright"   "$Copyright" `
  --set-version-string "OriginalFilename" "$ExeName" `
  --set-version-string "InternalName"     "DesktopBroom" `
  --set-file-version    "$FileVer" `
  --set-product-version "$FileVer"
if ($LASTEXITCODE -ne 0) { throw "rcedit FAILED (exit $LASTEXITCODE) - metadata not stamped." }
$vi = (Get-Item ".\$ExeName").VersionInfo
if ($vi.CompanyName -eq "Node.js") { throw "Metadata stamp did not take - still shows Node.js." }
Write-Host "     OK -> ProductName='$($vi.ProductName)'  Company='$($vi.CompanyName)'"

Write-Host "5/6  Injecting app blob (postject)..."
npx --yes postject "$ExeName" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse $Fuse

Write-Host "6/6  Verifying the exe runs..."
$out = & ".\$ExeName" how 2>&1 | Select-Object -First 6
if ($out -match "Desktop Broom") { Write-Host "     OK - launches and prints welcome." }
else { throw "Built exe did not run correctly. Output: $out" }

if ($Sign) {
  Write-Host "Self-signing..."
  & "$PSScriptRoot\sign.ps1" -ExePath ".\$ExeName"
}

Write-Host ""
Write-Host "DONE -> $PSScriptRoot\$ExeName"
Write-Host "Test it:  .\$ExeName plan `"$env:USERPROFILE\OneDrive\Desktop`""
