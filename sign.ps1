# Signs DesktopBroom.exe with Azure Trusted Signing.
#
# ONE-TIME SETUP (after your Trusted Signing account + certificate profile exist,
# and your Individual identity validation is APPROVED in the Azure portal):
#
#   1. Install-Module -Name TrustedSigning -Scope CurrentUser
#   2. Install-Module -Name Az.Accounts -Scope CurrentUser ; Connect-AzAccount
#   3. Fill in the three values below from your Trusted Signing account page:
#        - Endpoint:  the account's URI, e.g. https://eus.codesigning.azure.net/
#        - Account:   your Trusted Signing account name (e.g. desktopbroom-signing)
#        - Profile:   your certificate profile name (e.g. desktopbroom-public)
#
# Then: .\build-exe.ps1 -Sign     (or run this script directly on the exe)

param(
  [string]$ExePath = ".\DesktopBroom.exe",
  [string]$Endpoint = $env:TS_ENDPOINT,          # e.g. https://eus.codesigning.azure.net/
  [string]$Account  = $env:TS_ACCOUNT,           # e.g. desktopbroom-signing
  [string]$Profile  = $env:TS_PROFILE            # e.g. desktopbroom-public
)

$ErrorActionPreference = "Stop"

if (-not $Endpoint -or -not $Account -or -not $Profile) {
  Write-Host "Trusted Signing not configured yet." -ForegroundColor Yellow
  Write-Host "  Set TS_ENDPOINT / TS_ACCOUNT / TS_PROFILE (or edit sign.ps1) once your"
  Write-Host "  Azure Trusted Signing certificate profile is approved. Skipping signing."
  exit 0
}

if (-not (Get-Module -ListAvailable -Name TrustedSigning)) {
  throw "TrustedSigning module not installed. Run: Install-Module -Name TrustedSigning -Scope CurrentUser"
}
Import-Module TrustedSigning

Write-Host "Signing $ExePath via Trusted Signing ($Account / $Profile)..."
Invoke-TrustedSigning `
  -Endpoint               $Endpoint `
  -CodeSigningAccountName $Account `
  -CertificateProfileName $Profile `
  -Files                  $ExePath `
  -FileDigest             SHA256 `
  -TimestampRfc3161       "http://timestamp.acs.microsoft.com" `
  -TimestampDigest        SHA256

# Verify the signature took.
$sig = Get-AuthenticodeSignature $ExePath
Write-Host ("Signature status: {0}  Signer: {1}" -f $sig.Status, $sig.SignerCertificate.Subject)
if ($sig.Status -ne 'Valid') { throw "Signing did not produce a Valid signature (got $($sig.Status))." }
Write-Host "Signed successfully." -ForegroundColor Green
