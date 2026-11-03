<#
    Datto RMM component: install or upgrade the TechpioAsset agent on a laptop.

    Paste this into a Datto RMM component (Script, PowerShell) and push it to
    the laptops. It downloads the current agent from YOUR portal and runs its
    normal install, so the one job:
      * installs the agent where it is missing,
      * upgrades older agents in place (1.3.0 adds Online/Offline and
        Refresh now), and
      * repairs laptops whose credential the portal refuses ("Needs
        reinstall") - the install re-enrols them with the current token.

    Component variables (set on the component in Datto, never typed here):
      PortalUrl       https://pioassets.com/api/v1
      EnrolmentToken  Discovery -> Agents -> Show token in the portal.
                      Mark it as a masked/password variable in Datto.

    Datto runs components as SYSTEM, which is what the agent needs: it can
    read TPM/BitLocker state and write its protected credential file.
    Exit code 0 = installed and reported. Anything else: read the output.
#>
$ErrorActionPreference = 'Stop'

$portal = "$env:PortalUrl".Trim()
$token  = "$env:EnrolmentToken".Trim()
if (-not $portal -or -not $token) {
    Write-Output 'Set the PortalUrl and EnrolmentToken variables on this Datto component.'
    exit 1
}

# The script is served by the web app; the API lives under /api/v1 on the same site.
$site = $portal -replace '/api/v1/?$', ''
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$file = Join-Path $env:TEMP 'TechpioAgent.ps1'
try {
    Invoke-WebRequest -UseBasicParsing -Uri "$site/downloads/TechpioAgent.ps1" -OutFile $file
} catch {
    Write-Output "Could not download the agent from $site : $($_.Exception.Message)"
    exit 1
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $file `
    -PortalUrl $portal -EnrolmentToken $token -Install
$code = $LASTEXITCODE

# What is scheduled now - two tasks from 1.3.0 on.
Get-ScheduledTask -TaskName 'TechpioAsset*' -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Output ("Scheduled: {0} ({1})" -f $_.TaskName, $_.State) }
exit $code
