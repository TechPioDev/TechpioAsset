<#
.SYNOPSIS
    TechpioAsset inventory agent for Windows.

.DESCRIPTION
    Reports this machine's hardware, operating system and installed software to
    your TechpioAsset portal so the asset record stays current without anyone
    typing it in.

    WHAT IT DOES NOT DO, by design:
      * no remote command execution
      * no file, document or browsing-history access
      * no screen capture, no keystrokes, no location
      * no personal data beyond the Windows user name of local administrators
        (a count only - see Get-OsInfo)

    It is report-only and one-way: the agent POSTs, the portal never pushes
    anything back. The whole script is plain text so your IT team can read
    exactly what leaves the machine before trusting it.

.PARAMETER PortalUrl
    Base URL of the API, e.g. https://pioassets.com/api/v1

.PARAMETER EnrolmentToken
    The company enrolment token from Discovery -> Agents. Needed on the install
    run; it is then kept on this machine (encrypted, SYSTEM/Administrators
    only) so the scheduled task can repair a rejected device credential on its
    own.

.PARAMETER Install
    Registers a daily scheduled task that runs this script as SYSTEM.
    Re-running the install command upgrades an existing install in place.

.PARAMETER Uninstall
    Removes the scheduled task and the stored enrolment token.

.PARAMETER LoadOnly
    For the local test harness only: defines the functions and stops without
    running anything. Never needed on a real machine.

.EXAMPLE
    .\TechpioAgent.ps1 -PortalUrl https://pioassets.com/api/v1 -EnrolmentToken tae_xxx -Install

.NOTES
    Requires Windows PowerShell 5.1+ (present on every supported Windows) or
    PowerShell 7. Run elevated for the full picture: TPM, BitLocker and patch
    state are not readable as a standard user, and those fields are simply
    reported as null rather than guessed.

    CHANGELOG
    1.2.0  Reports who is signed in at the console, so the register can show
           who is using each machine and how long it has been up.
    1.1.0  A laptop can no longer silently stop reporting.
           * State "missing" and state "unreadable" are now different things.
             An agent.json that exists but cannot be read (an unelevated run)
             no longer triggers an enrolment - that enrolment rotated the
             machine's credential into a file the run could not write, which
             locked 26 laptops out. The run now stops with exit 1 and says to
             run elevated.
           * The device credential is saved atomically (temp file + replace)
             and read back to verify. If it does not verify after an
             enrolment, the new credential is NOT used and the run exits 1.
           * The company enrolment token is kept in enrol.bin (DPAPI
             LocalMachine, SYSTEM/Administrators only), so the scheduled task
             re-enrols by itself when the portal rejects the credential (401).
             Up to two tokens are kept (newest first) so re-running an old
             install command cannot strand a laptop on a replaced token.
           * Every report carries machineId, so the portal can attribute a
             rejected report to the laptop that sent it.
           * Runs are serialised by a machine-wide mutex (start-up trigger and
             an RMM push can no longer race each other through a re-enrol).
           * agent.log rolls to agent.log.1 at ~1 MB.
           * -Install upgrades the scheduled task even when the report failed,
             locks the ProgramData folder to SYSTEM/Administrators (users may
             read), and ACLs use well-known SIDs so non-English Windows works.
           * -Uninstall also removes enrol.bin. agent.json is still kept.
           * TLS 1.2 is enabled explicitly for Windows PowerShell 5.1.
    1.0.0  First release.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PortalUrl,
    [string]$EnrolmentToken,
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$LoadOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 on older builds still offers TLS 1.0/1.1 first; the
# portal only speaks TLS 1.2+. Add 1.2 without removing anything the OS allows.
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$script:AgentVersion = '1.2.0'
$script:TaskName     = 'TechpioAsset Inventory Agent'
$script:LogMaxBytes  = 1MB
$script:MutexName    = 'Global\TechpioAssetInventoryAgent'
$script:MaxStoredEnrolmentTokens = 2
# DPAPI entropy: not a secret, just keeps enrol.bin from being decrypted by a
# generic "Unprotect anything" call on this machine.
$script:EnrolEntropy = [Text.Encoding]::UTF8.GetBytes('TechpioAsset.Agent.EnrolmentToken.v1')

# Well-known SIDs, so the ACLs work on non-English Windows where the group is
# not called "Administrators".
$script:SidSystem = 'S-1-5-18'
$script:SidAdmins = 'S-1-5-32-544'
$script:SidUsers  = 'S-1-5-32-545'

<#
    All on-disk paths hang off one directory. The test harness points this at
    a scratch folder; the real agent always uses %ProgramData%\TechpioAsset
    (C:\ProgramData for SYSTEM too - no user profile or %TEMP% involved).
#>
function Set-AgentPaths {
    param([string]$Directory)
    $script:StateDir  = $Directory
    $script:StateFile = Join-Path $Directory 'agent.json'
    $script:EnrolFile = Join-Path $Directory 'enrol.bin'
    $script:LogFile   = Join-Path $Directory 'agent.log'
}
Set-AgentPaths -Directory (Join-Path $env:ProgramData 'TechpioAsset')

# ── helpers ──────────────────────────────────────────────────────────────────

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    try {
        if (-not (Test-Path -LiteralPath $script:StateDir)) {
            New-Item -ItemType Directory -Path $script:StateDir -Force | Out-Null
        }
        # Keep one previous generation; a daily agent that logs a few lines a
        # run never gets near 1 MB unless something loops, and then the newest
        # lines are the ones worth having.
        $existing = Get-Item -LiteralPath $script:LogFile -Force -ErrorAction SilentlyContinue
        if ($null -ne $existing -and $existing.Length -ge $script:LogMaxBytes) {
            Move-Item -LiteralPath $script:LogFile -Destination ($script:LogFile + '.1') -Force -ErrorAction SilentlyContinue
        }
        Add-Content -LiteralPath $script:LogFile -Value $line -ErrorAction SilentlyContinue
    } catch { }
}

<#
    Anything that reads hardware can fail on an odd machine - a missing WMI
    class, a locked-down VM, a laptop with no battery. A field we cannot read
    is reported as null; it is never guessed, and it never stops the run.
#>
function Try-Get {
    param([scriptblock]$Block)
    try { & $Block } catch { $null }
}


<#
    Reads a property that may not exist, without tripping StrictMode.
    Registry-derived objects are the reason this exists: two machines rarely
    expose the same set of value names.
#>
function Get-Prop {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

<#
    The innermost exception of an error record. .NET method calls surface in
    PowerShell wrapped in MethodInvocationException; the type that says WHAT
    went wrong (file not found vs access denied) is underneath.
#>
function Get-BaseError {
    param($ErrorRecord)
    $ex = $ErrorRecord
    if ($ErrorRecord -is [System.Management.Automation.ErrorRecord]) { $ex = $ErrorRecord.Exception }
    while ($null -ne $ex -and $null -ne $ex.InnerException) { $ex = $ex.InnerException }
    return $ex
}

<#
    The status code of a failed web call, or $null.

    Windows PowerShell 5.1 and PowerShell 7 raise different exception types
    here, and Set-StrictMode makes reading a property that does not exist a
    terminating error - so the shape is probed rather than assumed. Without
    this the error handler itself became the error.
#>
function Get-HttpStatus {
    param($ErrorRecord)
    try {
        $ex = $ErrorRecord.Exception
        if ($null -eq $ex) { return $null }
        $response = $ex.PSObject.Properties['Response']
        if ($null -eq $response -or $null -eq $response.Value) { return $null }
        $status = $response.Value.PSObject.Properties['StatusCode']
        if ($null -eq $status -or $null -eq $status.Value) { return $null }
        return [int]$status.Value
    } catch { return $null }
}

function Test-Elevated {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Get-MachineId {
    # The hardware UUID is stable across OS reinstalls, which is what makes it
    # the right identity: rebuilding a laptop must not create a second asset.
    $uuid = Try-Get { (Get-CimInstance Win32_ComputerSystemProduct).UUID }
    if ($uuid -and $uuid -notmatch '^(0{8}-|FFFFFFFF-)') { return $uuid }
    # Fall back to the machine GUID; still stable, less portable.
    $guid = Try-Get {
        (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
    }
    if ($guid) { return $guid }
    return "$env:COMPUTERNAME-$([System.Environment]::MachineName)"
}

# ── protected files ──────────────────────────────────────────────────────────

<#
    SYSTEM and Administrators get full control; nothing is inherited. With
    -UsersCanRead (the agent folder itself) standard users may read and list,
    which keeps the script and log inspectable, but may not create or replace
    files - a user-planted TechpioAgent.ps1 would otherwise run as SYSTEM.

    A fresh security object is used rather than Get-Acl's, so only the DACL is
    written: re-applying an owner we are not allowed to assign is a classic
    Set-Acl failure.
#>
function Set-RestrictedAcl {
    param([string]$Path, [switch]$UsersCanRead)
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer) {
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
        $acl = New-Object System.Security.AccessControl.FileSecurity
        $inherit = [System.Security.AccessControl.InheritanceFlags]::None
    }
    $none = [System.Security.AccessControl.PropagationFlags]::None
    $allow = [System.Security.AccessControl.AccessControlType]::Allow
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($script:SidSystem, $script:SidAdmins)) {
        $who = New-Object System.Security.Principal.SecurityIdentifier($sid)
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
            $who, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, $none, $allow)))
    }
    if ($UsersCanRead) {
        $who = New-Object System.Security.Principal.SecurityIdentifier($script:SidUsers)
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
            $who, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute, $inherit, $none, $allow)))
    }
    # Windows PowerShell 5.1's Set-Acl on a DIRECTORY also tries to write the
    # audit (SACL) section and fails without SeSecurityPrivilege. The .NET
    # Framework method writes only the sections that changed. PowerShell 7 has
    # no such instance method (it became an extension method); its Set-Acl is
    # fine.
    if ($null -ne $item.PSObject.Methods['SetAccessControl']) {
        $item.SetAccessControl($acl)
    } else {
        Set-Acl -LiteralPath $Path -AclObject $acl
    }
}

<#
    Writes a secret file so that it is either the old content or the complete
    new content, never half of either: write a temp file in the same folder,
    lock its ACL, then replace. Throws on any failure; the caller verifies by
    reading back.

    The temp file is locked BEFORE it is moved into place, so the final path
    never carries a readable-by-users ACL, even for a moment. In an unelevated
    run that lock also means the move fails - which is correct: an unelevated
    run must not produce a credential the next unelevated run cannot read.
#>
function Write-ProtectedFile {
    param([string]$Path, [byte[]]$Bytes)
    $dir = Split-Path -Parent $Path
    $leaf = Split-Path -Leaf $Path
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    # Leftovers from an earlier run that died mid-save.
    Get-ChildItem -LiteralPath $dir -Filter ".$leaf.*.tmp" -Force -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

    $tmp = Join-Path $dir (".{0}.{1}.tmp" -f $leaf, [guid]::NewGuid().ToString('N'))
    try {
        [System.IO.File]::WriteAllBytes($tmp, $Bytes)
        try {
            Set-RestrictedAcl -Path $tmp
        } catch {
            # A machine where the ACL cannot be set at all still gets a working
            # agent; the credential can only ever describe this one laptop.
            Write-Log ("Could not restrict permissions on {0}: {1}" -f $leaf, (Get-BaseError $_).Message) 'WARN'
        }
        if ([System.IO.File]::Exists($Path)) {
            try {
                # [NullString]: a plain $null becomes "" when PowerShell binds a
                # string argument, and Replace rejects an empty backup path.
                [System.IO.File]::Replace($tmp, $Path, [NullString]::Value)
            } catch {
                # Replace reports the real reason (usually access denied); a
                # failing fallback would only say "file already exists".
                $replaceError = (Get-BaseError $_).Message
                try {
                    Move-Item -LiteralPath $tmp -Destination $Path -Force
                } catch {
                    throw $replaceError
                }
            }
        } else {
            [System.IO.File]::Move($tmp, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $tmp) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
    }
}

# ── state (device credential) ────────────────────────────────────────────────

<#
    Status is one of:
      Missing    - no agent.json: this machine has never been enrolled here.
      Unreadable - agent.json exists but this process cannot read it. Almost
                   always an unelevated run. NEVER a reason to enrol: the
                   credential inside is probably fine, and enrolling would
                   rotate it into a file this run cannot write (the 1.0.0
                   lock-out).
      Corrupt    - agent.json was read but holds no credential (e.g. a
                   half-written file from 1.0.0's non-atomic save). Being able
                   to READ it proves the ACL is not what stands in the way, so
                   enrolling and replacing it is safe - otherwise such a laptop
                   could never recover without someone deleting the file.
      Ok         - DeviceToken is set.
#>
function Get-AgentState {
    $text = $null
    try {
        $text = [System.IO.File]::ReadAllText($script:StateFile)
    } catch {
        $base = Get-BaseError $_
        if ($base -is [System.IO.FileNotFoundException] -or $base -is [System.IO.DirectoryNotFoundException]) {
            return [pscustomobject]@{ Status = 'Missing'; DeviceToken = $null; Reason = $null }
        }
        return [pscustomobject]@{ Status = 'Unreadable'; DeviceToken = $null; Reason = $base.Message }
    }
    $obj = $null
    try { $obj = $text | ConvertFrom-Json } catch { $obj = $null }
    $token = [string](Get-Prop $obj 'deviceToken')
    if ([string]::IsNullOrWhiteSpace($token)) {
        return [pscustomobject]@{ Status = 'Corrupt'; DeviceToken = $null; Reason = 'no device credential in the file' }
    }
    return [pscustomobject]@{ Status = 'Ok'; DeviceToken = $token; Reason = $null }
}

<# Returns $true only when the credential was written AND reads back intact. #>
function Save-AgentState {
    param([string]$DeviceToken, [string]$MachineId)
    try {
        $json = [ordered]@{
            deviceToken = $DeviceToken
            machineId   = $MachineId
            version     = $script:AgentVersion
            savedAt     = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json
        Write-ProtectedFile -Path $script:StateFile -Bytes ([System.Text.Encoding]::UTF8.GetBytes($json))
    } catch {
        Write-Log ("Could not save the device credential to {0}: {1}" -f $script:StateFile, (Get-BaseError $_).Message) 'ERROR'
        return $false
    }
    $check = Get-AgentState
    if ($check.Status -ne 'Ok' -or $check.DeviceToken -cne $DeviceToken) {
        $why = $check.Status
        if ($check.Reason) { $why = "$why - $($check.Reason)" }
        Write-Log ("The device credential was written but did not read back correctly ({0})." -f $why) 'ERROR'
        return $false
    }
    return $true
}

# ── stored enrolment token (self-repair) ─────────────────────────────────────

function Initialize-Dpapi {
    # ProtectedData lives in System.Security on Windows PowerShell 5.1.
    try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch { }
}

<#
    Newest first. Empty when there is no enrol.bin or it cannot be used; this
    never throws, because a missing repair token must not stop a healthy
    laptop from reporting.
#>
function Get-StoredEnrolmentTokens {
    $bytes = $null
    try {
        $bytes = [System.IO.File]::ReadAllBytes($script:EnrolFile)
    } catch {
        $base = Get-BaseError $_
        if ($base -is [System.IO.FileNotFoundException] -or $base -is [System.IO.DirectoryNotFoundException]) {
            return @()
        }
        Write-Log ("Could not read the stored enrolment token ({0}); self-repair is unavailable in this run." -f $base.Message) 'WARN'
        return @()
    }
    try {
        Initialize-Dpapi
        $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $bytes, $script:EnrolEntropy, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
        $obj = [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
        $list = @(Get-Prop $obj 'tokens')
        return @($list | Where-Object { $_ -is [string] -and -not [string]::IsNullOrWhiteSpace($_) })
    } catch {
        Write-Log ("The stored enrolment token could not be decrypted ({0}); self-repair is unavailable until the install command is re-run." -f (Get-BaseError $_).Message) 'WARN'
        return @()
    }
}

<#
    DPAPI LocalMachine scope: bound to this Windows install, so a copied
    enrol.bin is useless elsewhere. Any local process could decrypt it, which is
    why the file itself is locked to SYSTEM and Administrators - the same
    people who can already read agent.json. Returns $true when verified.
#>
function Save-StoredEnrolmentTokens {
    param([string[]]$Tokens)
    try {
        Initialize-Dpapi
        $json = @{ tokens = @($Tokens) } | ConvertTo-Json -Compress
        $cipher = [System.Security.Cryptography.ProtectedData]::Protect(
            [System.Text.Encoding]::UTF8.GetBytes($json), $script:EnrolEntropy,
            [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
        Write-ProtectedFile -Path $script:EnrolFile -Bytes $cipher
    } catch {
        Write-Log ("Could not store the company enrolment token for self-repair ({0}). Run the install command elevated." -f (Get-BaseError $_).Message.TrimEnd('.')) 'WARN'
        return $false
    }
    $back = @(Get-StoredEnrolmentTokens)
    if ($back.Count -ne @($Tokens).Count -or ($back.Count -gt 0 -and $back[0] -cne @($Tokens)[0])) {
        Write-Log 'The stored enrolment token did not read back correctly; self-repair may be unavailable.' 'WARN'
        return $false
    }
    return $true
}

# ── collection ───────────────────────────────────────────────────────────────

function Get-HardwareInfo {
    $cs      = Try-Get { Get-CimInstance Win32_ComputerSystem }
    $bios    = Try-Get { Get-CimInstance Win32_BIOS }
    $cpu     = Try-Get { Get-CimInstance Win32_Processor | Select-Object -First 1 }
    $gpu     = Try-Get { Get-CimInstance Win32_VideoController | Select-Object -First 1 }
    $memory  = Try-Get { @(Get-CimInstance Win32_PhysicalMemory) }
    $array   = Try-Get { Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1 }
    $sysDisk = Try-Get { Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'" }
    $battery = Try-Get { Get-CimInstance Win32_Battery | Select-Object -First 1 }

    # SMART: healthy unless a physical disk says otherwise.
    $smart = Try-Get {
        $states = @(Get-CimInstance -Namespace root\Microsoft\Windows\Storage -ClassName MSFT_PhysicalDisk |
                    Select-Object -ExpandProperty HealthStatus)
        if ($states -contains 2) { 'FAILING' } elseif ($states -contains 1) { 'WARNING' } else { 'HEALTHY' }
    }

    # Battery health = full charge capacity vs design capacity.
    $batteryPct = Try-Get {
        $full   = (Get-CimInstance -Namespace root\WMI -ClassName BatteryFullChargedCapacity -ErrorAction Stop |
                   Select-Object -First 1).FullChargedCapacity
        $design = (Get-CimInstance -Namespace root\WMI -ClassName BatteryStaticData -ErrorAction Stop |
                   Select-Object -First 1).DesignedCapacity
        if ($design -gt 0) { [int][math]::Round(($full / $design) * 100) } else { $null }
    }

    [ordered]@{
        manufacturer      = Try-Get { $cs.Manufacturer }
        modelName         = Try-Get { $cs.Model }
        cpu               = Try-Get { $cpu.Name }
        cpuCores          = Try-Get { [int]$cpu.NumberOfCores }
        ramGb             = Try-Get { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) }
        ramSlotsUsed      = Try-Get { @($memory).Count }
        ramSlotsTotal     = Try-Get { [int]$array.MemoryDevices }
        storageTotalGb    = Try-Get { [math]::Round($sysDisk.Size / 1GB, 1) }
        storageFreeGb     = Try-Get { [math]::Round($sysDisk.FreeSpace / 1GB, 1) }
        smartStatus       = $smart
        batteryHealthPct  = $batteryPct
        batteryCycleCount = Try-Get { [int]$battery.CycleCount }
        gpu               = Try-Get { $gpu.Name }
        biosVersion       = Try-Get { $bios.SMBIOSBIOSVersion }
    }
}

function Get-OsInfo {
    $os = Try-Get { Get-CimInstance Win32_OperatingSystem }

    $encrypted = Try-Get {
        # 1 = fully encrypted. Needs elevation; null when not readable.
        $v = Get-CimInstance -Namespace root\CIMV2\Security\MicrosoftVolumeEncryption `
             -ClassName Win32_EncryptableVolume -ErrorAction Stop |
             Where-Object { $_.DriveLetter -eq $env:SystemDrive } | Select-Object -First 1
        if ($null -ne $v) { [bool]($v.GetConversionStatus().ConversionStatus -eq 1) } else { $null }
    }

    [ordered]@{
        osName                 = Try-Get { $os.Caption }
        osVersion              = Try-Get { $os.Version }
        osBuild                = Try-Get { $os.BuildNumber }
        osActivated            = Try-Get {
            $lic = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND Name LIKE 'Windows%'" |
                   Select-Object -First 1
            [bool]($lic.LicenseStatus -eq 1)
        }
        lastBootAt             = Try-Get { $os.LastBootUpTime.ToString('o') }
        # The console account. Running as SYSTEM, Win32_ComputerSystem.UserName
        # is the interactive user; the owner of explorer.exe is the fallback.
        # Sent as null when nobody is signed in, so the portal can tell that
        # apart from an agent too old to report it.
        activeUser             = Try-Get {
            $u = (Get-CimInstance Win32_ComputerSystem).UserName
            if ([string]::IsNullOrWhiteSpace($u)) {
                $p = Get-Process explorer -IncludeUserName -ErrorAction SilentlyContinue | Select-Object -First 1
                $u = $p.UserName
            }
            if ([string]::IsNullOrWhiteSpace($u)) { $null } else { [string]$u }
        }
        diskEncrypted          = $encrypted
        defenderEnabled        = Try-Get { [bool](Get-MpComputerStatus).RealTimeProtectionEnabled }
        firewallEnabled        = Try-Get { [bool](@(Get-NetFirewallProfile | Where-Object Enabled).Count -gt 0) }
        tpmPresent             = Try-Get { [bool](Get-Tpm).TpmPresent }
        # A COUNT of local administrators, never their names: "how many people
        # can change this machine" is an asset-risk signal; who they are is not
        # the asset system's business.
        localAdminCount        = Try-Get { @(Get-LocalGroupMember -Group 'Administrators').Count }
        missingCriticalPatches = Try-Get {
            $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
            @($searcher.Search("IsInstalled=0 AND Type='Software'").Updates).Count
        }
    }
}

function Get-InstalledSoftware {
    <#
        Read from the uninstall registry keys, NOT Win32_Product.
        Win32_Product triggers an MSI consistency check on every installed
        package - it is slow and can silently start repair operations on a
        user's machine. The registry is what Add/Remove Programs itself reads.
    #>
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    # StrictMode turns "read a property this key does not have" into a
    # terminating error, and uninstall keys are wildly inconsistent - plenty
    # carry no DisplayName at all. Every read goes through Get-Prop.
    $items = foreach ($path in $paths) {
        Try-Get { @(Get-ItemProperty $path -ErrorAction SilentlyContinue) }
    }

    $seen = @{}
    $out = foreach ($item in $items) {
        if ($null -eq $item) { continue }
        $name = Get-Prop $item 'DisplayName'
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        # Hide OS components and driver/update entries; these are not software
        # anyone manages, and they bury the applications that matter.
        if (Get-Prop $item 'SystemComponent') { continue }
        if (Get-Prop $item 'ReleaseType') { continue }
        if (Get-Prop $item 'ParentKeyName') { continue }

        $version = Get-Prop $item 'DisplayVersion'
        $key = "$name|$version"
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true

        $rawDate = Get-Prop $item 'InstallDate'
        $installed = $null
        if ($rawDate -and "$rawDate" -match '^\d{8}$') {
            $installed = Try-Get {
                [datetime]::ParseExact("$rawDate", 'yyyyMMdd', $null).ToString('o')
            }
        }
        [ordered]@{
            name        = [string]$name
            version     = if ($version) { [string]$version } else { $null }
            publisher   = $(if ($p = Get-Prop $item 'Publisher') { [string]$p } else { $null })
            installedAt = $installed
        }
    }
    # The API accepts up to 5000 entries; stay well inside it.
    @($out | Select-Object -First 2000)
}

function Get-InventoryPayload {
    param([string]$MachineId)
    Write-Log 'Collecting inventory'
    [ordered]@{
        # machineId lets the portal attribute a REJECTED report to the laptop
        # that sent it. Identity for accepted reports still comes from the
        # credential, never from this field.
        machineId    = $MachineId
        hostname     = $env:COMPUTERNAME
        serialNumber = Try-Get { (Get-CimInstance Win32_BIOS).SerialNumber }
        agentVersion = $script:AgentVersion
        hardware     = Get-HardwareInfo
        os           = Get-OsInfo
        software     = Get-InstalledSoftware
    }
}

# ── portal calls ─────────────────────────────────────────────────────────────

function Invoke-Portal {
    param([string]$Path, [hashtable]$Headers, $Body)
    $uri = "$($PortalUrl.TrimEnd('/'))$Path"
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    # -UseBasicParsing keeps this working on Server Core, where IE's DOM parser
    # is absent.
    Invoke-RestMethod -Uri $uri -Method Post -Headers $Headers -Body $json `
        -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60
}

<#
    Exchanges a company enrolment token for a device credential. Tries each
    stored token in order (newest first). Returns an object:
      DeviceToken     - the new credential, or $null when every token was refused
      RejectedTokens  - tokens the portal refused (401/403)
    Anything other than a refusal (network down, 5xx, 429) throws: that says
    nothing about whether a token is valid.
#>
function Invoke-Enrolment {
    param([string]$MachineId, [string[]]$EnrolmentTokens)
    $body = @{
        machineId    = $MachineId
        hostname     = $env:COMPUTERNAME
        serialNumber = Try-Get { (Get-CimInstance Win32_BIOS).SerialNumber }
        platform     = 'windows'
        agentVersion = $script:AgentVersion
    }
    $rejected = @()
    $n = @($EnrolmentTokens).Count
    $i = 0
    foreach ($candidate in @($EnrolmentTokens)) {
        $i++
        Write-Log ("Enrolling {0} (enrolment token {1} of {2})" -f $MachineId, $i, $n)
        $res = $null
        try {
            $res = Invoke-Portal -Path '/discovery/agents/enrol' `
                -Headers @{ 'x-enrolment-token' = $candidate } -Body $body
        } catch {
            $status = Get-HttpStatus $_
            if ($status -eq 401 -or $status -eq 403) {
                Write-Log ("Enrolment token {0} of {1} was refused by the portal (HTTP {2})." -f $i, $n, $status) 'WARN'
                $rejected += $candidate
                continue
            }
            throw
        }
        $token = [string](Get-Prop (Get-Prop $res 'data') 'deviceToken')
        if ([string]::IsNullOrWhiteSpace($token)) { throw 'Enrolment did not return a device credential.' }
        return [pscustomobject]@{ DeviceToken = $token; RejectedTokens = $rejected }
    }
    return [pscustomobject]@{ DeviceToken = $null; RejectedTokens = $rejected }
}

<#
    Enrol, then save-and-verify. Returns the new credential, or $null after
    logging an ERROR explaining why (the caller exits 1).

    DECISION - what to do when the save does not verify:
    the new credential is NOT used for a report. Enrolment rotates the
    machine's credential on the portal, and the portal keeps the previous one
    valid until the new one is used once. Reporting with a credential that
    exists only in this process's memory would (a) retire the previous
    credential for good, and (b) make the laptop look healthy today while the
    next scheduled run is guaranteed to fail - exactly how 1.0.0 hid 26 dead
    laptops. Not reporting keeps whatever is on disk as valid as it was, lets
    the portal's "last reported" go stale where someone will see it, and the
    run exits 1 with a message that says how to fix it.
#>
function New-DeviceCredential {
    param([string]$MachineId, [string[]]$EnrolmentTokens)
    if (@($EnrolmentTokens).Count -eq 0) {
        Write-Log 'This laptop needs a new device credential but has no company enrolment token stored. Re-run the install command copied from Discovery -> Agents (elevated, or via your RMM as SYSTEM).' 'ERROR'
        return $null
    }
    $enrol = Invoke-Enrolment -MachineId $MachineId -EnrolmentTokens $EnrolmentTokens
    if (-not $enrol.DeviceToken) {
        Write-Log 'The company enrolment token on this laptop is no longer valid - re-run the install command copied from Discovery -> Agents.' 'ERROR'
        return $null
    }
    if (-not (Save-AgentState -DeviceToken $enrol.DeviceToken -MachineId $MachineId)) {
        Write-Log 'Enrolled, but the new device credential could not be saved and verified, so it will NOT be used (the previous credential stays valid on the portal). Run this elevated (as Administrator) or let the scheduled task run it as SYSTEM.' 'ERROR'
        return $null
    }
    Write-Log 'Enrolled; device credential saved and verified.'

    # A token that was refused while an older one worked is a stale install
    # command someone re-ran; drop it so it is not tried first forever.
    if (@($enrol.RejectedTokens).Count -gt 0) {
        $keep = @($EnrolmentTokens | Where-Object { $enrol.RejectedTokens -cnotcontains $_ })
        if ($keep.Count -gt 0) {
            if (Save-StoredEnrolmentTokens -Tokens $keep) {
                Write-Log 'Removed a refused enrolment token from this laptop.'
            }
        }
    }
    return $enrol.DeviceToken
}

<#
    Posts the inventory. Returns 'Ok' or 'Unauthorized'; anything else throws.
#>
function Send-Inventory {
    param([string]$DeviceToken, $Payload)
    Write-Log ("Reporting {0} software entries" -f @($Payload.software).Count)
    $headers = @{ Authorization = "Bearer $DeviceToken" }
    $res = $null
    try {
        $res = Invoke-Portal -Path '/discovery/agents/report' -Headers $headers -Body $Payload
    } catch {
        $status = Get-HttpStatus $_
        if ($status -eq 401) { return 'Unauthorized' }
        # A portal older than 1.1.0 validates the report strictly and does not
        # know machineId yet. The credential already passed (401 is checked
        # first), so resend without it rather than stop reporting.
        if ($status -eq 400 -and $Payload.Contains('machineId')) {
            Write-Log 'Portal refused the report shape (HTTP 400); retrying without machineId for an older portal.' 'WARN'
            $legacy = [ordered]@{}
            foreach ($k in $Payload.Keys) { if ($k -ne 'machineId') { $legacy[$k] = $Payload[$k] } }
            try {
                $res = Invoke-Portal -Path '/discovery/agents/report' -Headers $headers -Body $legacy
            } catch {
                if ((Get-HttpStatus $_) -eq 401) { return 'Unauthorized' }
                throw
            }
        } else {
            throw
        }
    }
    $data = Get-Prop $res 'data'
    Write-Log ("Reported. Portal matched={0} proposed={1} unmatched={2}" -f `
        (Get-Prop $data 'matched'), (Get-Prop $data 'proposed'), (Get-Prop $data 'unmatched'))
    return 'Ok'
}

# ── scheduled task ───────────────────────────────────────────────────────────

function Install-Task {
    # $MyInvocation.MyCommand inside a function is the FUNCTION's info, which
    # has no .Path - under StrictMode that read is the crash a real install
    # died on. $PSCommandPath is the script-level automatic variable and is
    # correct in both Windows PowerShell 5.1 and PowerShell 7.
    $self = $PSCommandPath
    if (-not $self) { throw 'Cannot install the scheduled task: run the agent from a saved .ps1 file (powershell -File ...).' }

    if (-not (Test-Path -LiteralPath $script:StateDir)) {
        New-Item -ItemType Directory -Path $script:StateDir -Force | Out-Null
    }
    # The folder holds a script that runs as SYSTEM. By default ProgramData
    # lets any user create files in new subfolders, so lock it: SYSTEM and
    # Administrators write, users read.
    try {
        Set-RestrictedAcl -Path $script:StateDir -UsersCanRead
    } catch {
        Write-Log ("Could not restrict permissions on {0}: {1}" -f $script:StateDir, (Get-BaseError $_).Message) 'WARN'
    }

    # The install one-liner downloads the script to %TEMP%, which temp
    # cleanup empties and the SYSTEM account may not read at all. The task
    # must outlive both, so the agent copies itself next to its state file
    # and schedules THAT copy. On an upgrade this replaces the old version.
    $home_ = Join-Path $script:StateDir 'TechpioAgent.ps1'
    if ($self -ne $home_) {
        # Remove first: a copy onto an existing file keeps that file's owner
        # and ACL, and the file must be ours.
        if (Test-Path -LiteralPath $home_) { Remove-Item -LiteralPath $home_ -Force }
        Copy-Item -LiteralPath $self -Destination $home_ -Force
        $self = $home_
    }

    $taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -PortalUrl `"$PortalUrl`""
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
    # Daily, plus at start-up so a laptop that was off overnight still reports.
    # The +/-30min jitter belongs to the TRIGGER - RandomDelay is not a
    # parameter of New-ScheduledTaskSettingsSet, and PowerShell 5.1 says so
    # only at run time, on a real machine, during a real install.
    $daily   = New-ScheduledTaskTrigger -Daily -At 12pm -RandomDelay (New-TimeSpan -Minutes 30)
    $startup = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable `
                    -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

    Register-ScheduledTask -TaskName $script:TaskName -Action $action `
        -Trigger @($daily, $startup) -Principal $principal -Settings $settings -Force | Out-Null
    Write-Log "Scheduled task '$($script:TaskName)' installed for agent $($script:AgentVersion) (daily 12:00 +/-30m, and at start-up)."
}

function Uninstall-Agent {
    Try-Get { Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false } | Out-Null
    Write-Log 'Scheduled task removed.'
    $code = 0
    if (Test-Path -LiteralPath $script:EnrolFile) {
        try {
            Remove-Item -LiteralPath $script:EnrolFile -Force
            Write-Log 'Stored company enrolment token removed.'
        } catch {
            Write-Log ("Could not remove {0}: {1}. Run this elevated." -f $script:EnrolFile, (Get-BaseError $_).Message) 'ERROR'
            $code = 1
        }
    }
    # Unchanged from 1.0.0: the device credential is kept, so reinstalling
    # resumes the same device record instead of rotating its credential.
    Write-Log "State kept at $script:StateFile (delete it to fully unenrol)."
    return $code
}

# ── single run at a time ─────────────────────────────────────────────────────

<#
    The start-up trigger, the daily trigger and an RMM push can overlap. Two
    runs re-enrolling at once would rotate each other's credential, so runs
    queue behind a machine-wide mutex. Returns the held mutex, $null when no
    lock could be opened (run anyway), or $false when another run holds it
    for too long.
#>
function Enter-AgentLock {
    $mutex = $null
    try {
        $mutex = New-Object System.Threading.Mutex($false, $script:MutexName)
    } catch {
        Write-Log ("Could not open the single-run lock ({0}); continuing without it." -f (Get-BaseError $_).Message) 'WARN'
        return $null
    }
    $acquired = $false
    try {
        $acquired = $mutex.WaitOne([TimeSpan]::FromMinutes(20))
    } catch {
        # A previous run died holding the lock; we own it now.
        if ((Get-BaseError $_) -is [System.Threading.AbandonedMutexException]) { $acquired = $true } else { throw }
    }
    if (-not $acquired) {
        $mutex.Dispose()
        return $false
    }
    return $mutex
}

function Exit-AgentLock {
    param($Mutex)
    if ($null -eq $Mutex -or $Mutex -is [bool]) { return }
    try { $Mutex.ReleaseMutex() } catch { }
    try { $Mutex.Dispose() } catch { }
}

# ── main ─────────────────────────────────────────────────────────────────────

<#
    One reporting pass. Returns the process exit code: 0 only when the portal
    accepted a report with a credential that is safely on disk.
#>
function Invoke-Reporting {
    param([string]$MachineId, $State, [string[]]$EnrolmentTokens)

    $enrolledThisRun = $false
    $deviceToken = $null
    if ($State.Status -eq 'Ok') {
        $deviceToken = $State.DeviceToken
    } else {
        if ($State.Status -eq 'Corrupt') {
            Write-Log ("{0} is readable but holds no device credential; enrolling to replace it." -f $script:StateFile) 'WARN'
        } else {
            Write-Log 'This laptop is not enrolled yet.'
        }
        $deviceToken = New-DeviceCredential -MachineId $MachineId -EnrolmentTokens $EnrolmentTokens
        if (-not $deviceToken) { return 1 }
        $enrolledThisRun = $true
    }

    $payload = Get-InventoryPayload -MachineId $MachineId
    $outcome = Send-Inventory -DeviceToken $deviceToken -Payload $payload
    if ($outcome -eq 'Ok') { return 0 }

    if ($enrolledThisRun) {
        Write-Log 'The portal rejected a device credential it issued moments ago (HTTP 401). Not retrying; check the laptop in Discovery -> Agents.' 'ERROR'
        return 1
    }

    # A rejected credential: revoked, rotated by an earlier run that could not
    # save, or a machine rebuilt from an image. Repair it once with the stored
    # company enrolment token.
    Write-Log 'The portal rejected the stored device credential (HTTP 401); re-enrolling.' 'WARN'
    $deviceToken = New-DeviceCredential -MachineId $MachineId -EnrolmentTokens $EnrolmentTokens
    if (-not $deviceToken) { return 1 }
    $outcome = Send-Inventory -DeviceToken $deviceToken -Payload $payload
    if ($outcome -eq 'Ok') { return 0 }
    Write-Log 'The portal rejected the new device credential too (HTTP 401). Not retrying; check the laptop in Discovery -> Agents.' 'ERROR'
    return 1
}

function Invoke-Agent {
    param([string]$EnrolmentToken, [switch]$Install, [switch]$Uninstall)

    if ($Uninstall) { return (Uninstall-Agent) }

    $who = Try-Get { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
    Write-Log ("TechpioAsset agent {0} starting (PowerShell {1}, as {2}, elevated={3})" -f `
        $script:AgentVersion, $PSVersionTable.PSVersion, $who, (Test-Elevated))

    $lock = Enter-AgentLock
    if ($lock -is [bool]) {
        Write-Log 'Another TechpioAsset agent run has held the lock for 20 minutes; skipping this run.' 'ERROR'
        return 1
    }
    try {
        $machineId = Get-MachineId
        $state = Get-AgentState
        if ($state.Status -eq 'Unreadable') {
            # Deliberately NOT enrolling - see Get-AgentState.
            Write-Log ("The device credential file {0} exists but cannot be read ({1}). Not enrolling again, because that would replace a working credential with one this run cannot store. Run this elevated (as Administrator) or let the scheduled task run it as SYSTEM." -f $script:StateFile, $state.Reason) 'ERROR'
            return 1
        }

        # Company enrolment tokens for self-repair: the one passed now (the
        # operator's latest intent) first, then what is already stored.
        $tokens = @(Get-StoredEnrolmentTokens)
        if ($EnrolmentToken) {
            $EnrolmentToken = $EnrolmentToken.Trim()
            $merged = @($EnrolmentToken) + @($tokens | Where-Object { $_ -cne $EnrolmentToken })
            $tokens = @($merged | Select-Object -First $script:MaxStoredEnrolmentTokens)
            if (Save-StoredEnrolmentTokens -Tokens $tokens) {
                Write-Log 'Company enrolment token stored on this laptop for self-repair.'
            }
        }

        $code = 1
        try {
            $code = Invoke-Reporting -MachineId $machineId -State $state -EnrolmentTokens $tokens
        } catch {
            Write-Log ("Report failed: {0}" -f (Get-BaseError $_).Message) 'ERROR'
            $code = 1
        }

        # Install/upgrade the task even when this report failed (network down,
        # portal busy): an upgrade must not leave 1.0.0 scheduled, and a laptop
        # with a task keeps retrying on its own.
        if ($Install) {
            try {
                Install-Task
            } catch {
                Write-Log ("Could not install the scheduled task: {0}. Run the install command elevated." -f (Get-BaseError $_).Message) 'ERROR'
                $code = 1
            }
        }

        if ($code -eq 0) { Write-Log 'Done.' } else { Write-Log 'Finished with errors (exit 1).' 'ERROR' }
        return $code
    } finally {
        Exit-AgentLock $lock
    }
}

if ($LoadOnly) { return }

$exitCode = 1
try {
    $exitCode = Invoke-Agent -EnrolmentToken $EnrolmentToken -Install:$Install -Uninstall:$Uninstall |
        Select-Object -Last 1
} catch {
    Write-Log (Get-BaseError $_).Message 'ERROR'
    $exitCode = 1
}
exit ([int]$exitCode)
