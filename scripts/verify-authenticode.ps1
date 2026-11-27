param(
  [Parameter(Mandatory = $true)][string] $Installer,
  [Parameter(Mandatory = $true)][string] $Application
)

$ErrorActionPreference = 'Stop'
$expected = $env:TRANSMISSION_SIGNER_SHA256
if ($expected -notmatch '\A[0-9A-Fa-f]{64}\z') {
  throw 'TRANSMISSION_SIGNER_SHA256 must identify the publisher certificate by its SHA-256 fingerprint.'
}

$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  foreach ($file in @($Installer, $Application)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode' -or -not $signature.TimeStamperCertificate) {
      throw "A valid timestamped Authenticode signature is required on $file (status $($signature.Status))."
    }
    $fingerprint = [BitConverter]::ToString($sha256.ComputeHash($signature.SignerCertificate.RawData)).Replace('-', '')
    if ($fingerprint -ne $expected) {
      throw "Unexpected Authenticode publisher certificate on $file."
    }
    Write-Output "Verified Authenticode publisher on $file."
  }
} finally {
  $sha256.Dispose()
}
