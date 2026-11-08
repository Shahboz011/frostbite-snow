<#
.SYNOPSIS
  Creates a self-signed code-signing certificate for sideload-testing the MSIX
  on your own machine. NOT for distribution (the Store signs Store packages).

.DESCRIPTION
  The certificate subject must equal the manifest's Publisher exactly. After
  running this, trust it once (elevated PowerShell):

    Import-PfxCertificate -FilePath .\frostbite-test.pfx `
      -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pw

  then double-click the signed .msix to install.

.EXAMPLE
  $pw = Read-Host -AsSecureString
  ./packaging/msix/new-test-cert.ps1 -Password $pw
#>
param(
  [string] $Publisher = "CN=FrostbiteDev",
  [string] $OutFile = "frostbite-test.pfx",
  [Parameter(Mandatory)] [SecureString] $Password
)
$ErrorActionPreference = "Stop"
$cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature `
  -FriendlyName "Frostbite MSIX test signing" -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
Export-PfxCertificate -Cert $cert -FilePath $OutFile -Password $Password | Out-Null
Write-Host "Wrote $OutFile (subject $Publisher, thumbprint $($cert.Thumbprint))"
