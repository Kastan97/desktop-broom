# Builds DeskSweep.exe from desksweep.js using Node's built-in Single Executable
# Application (SEA) feature. Requires Node 20+ (you have 24).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "1/5  Generating icon..."
node make-icon.js

Write-Host "2/5  Building SEA blob..."
node --experimental-sea-config sea-config.json

Write-Host "3/5  Copying node.exe -> DeskSweep.exe..."
$node = (Get-Command node).Source
Copy-Item $node ".\DeskSweep.exe" -Force

Write-Host "4/5  Injecting app blob (postject)..."
# postject is fetched on demand via npx (needs internet the first time)
npx --yes postject DeskSweep.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

Write-Host "5/5  Setting icon (rcedit, optional)..."
try { npx --yes rcedit ".\DeskSweep.exe" --set-icon ".\icon.ico" --set-version-string "ProductName" "DeskSweep" --set-version-string "FileDescription" "DeskSweep - Freeware Problem Solver" }
catch { Write-Host "   (rcedit skipped: $($_.Exception.Message)) - exe still works, just uses the default node icon." }

Write-Host ""
Write-Host "DONE -> $PSScriptRoot\DeskSweep.exe"
Write-Host "Test it:  .\DeskSweep.exe plan `"$env:USERPROFILE\Desktop`""
