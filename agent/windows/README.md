# TechpioAsset Inventory Agent (Windows)

Reports a laptop's hardware, operating system and installed software to your
TechpioAsset portal, so asset records stay current without anyone typing them in.

It is **report-only**. The agent POSTs; the portal never pushes anything back.
From 1.3.0 it also checks in every five minutes ("I am on"), which is how the
portal shows **Online / Offline**. The only answer a check-in can get is "send a
full report now", when someone pressed **Refresh now** in the portal.

---

## What it collects

| Group | Fields |
|---|---|
| **Identity** | hostname, BIOS serial number, hardware UUID |
| **Hardware** | manufacturer, model, CPU + core count, RAM (GB, slots used/total), storage total/free, GPU, BIOS version, SMART health, battery health % and cycle count |
| **Operating system** | name, version, build, activation, last boot, BitLocker encryption, Defender real-time protection, firewall, TPM presence, count of local administrators, count of missing updates |
| **Software** | installed applications with version, publisher and install date |

## What it does **not** collect

- No remote command execution — there is no code path that runs anything the portal sends
- No files, documents, or browsing history
- No screen capture, keystrokes, webcam, microphone or location
- **No names of local administrators** — only how many there are, because "how many people can change this machine" is an asset-risk signal while *who they are* is not the asset system's business

The script is plain text. Read it before you trust it — that is why it is not a
compiled binary.

---

## Security model

The agent never carries an administrator's credential. Two different secrets:

1. **Enrolment token** (`tae_…`) — company-wide, in the installer. It can *only*
   be exchanged for a device credential; it cannot read or write anything. Rotate
   it any time from the portal; every installer carrying the old one stops
   enrolling immediately.
2. **Device credential** (`tad_…`) — minted per laptop at enrolment, stored at
   `C:\ProgramData\TechpioAsset\agent.json` (SYSTEM + Administrators only). It can
   post **this one machine's** inventory and nothing else. The device identity comes
   from the credential, never the request body, so a stolen credential cannot be used
   to describe — or overwrite — a different laptop.

Revoking a laptop in the portal kills its credential on the next call. The
enrolment row is kept, so the history stays readable.

---

## Install

### 1. Get an enrolment token

In the portal: **Discovery → Agents → Generate enrolment token**. It is shown
once. Requires the *Discovery ingest* permission (Super Admin, Company Admin or
IT Administrator).

### 2. Run once per laptop, elevated

The portal serves the script itself, so nothing needs copying by hand — this
single line downloads it and installs it, from any directory:

```powershell
iwr -useb https://pioassets.com/downloads/TechpioAgent.ps1 -OutFile $env:TEMP\TechpioAgent.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\TechpioAgent.ps1 -PortalUrl https://pioassets.com/api/v1 -EnrolmentToken tae_your_token_here -Install
```

The `-ExecutionPolicy Bypass` matters: Windows' default policy refuses
downloaded `.ps1` files, so running the script directly fails on a stock
machine. If you already have the file locally (Intune, GPO, a USB stick),
the direct form works too:

```powershell
.\TechpioAgent.ps1 `
    -PortalUrl https://pioassets.com/api/v1 `
    -EnrolmentToken tae_your_token_here `
    -Install
```

`-Install` registers two scheduled tasks that run as SYSTEM:

- **TechpioAsset Inventory Agent** — the full report, **daily at 12:00 (±30 min
  jitter)** and **at start-up**, so a laptop that was closed overnight still
  reports. The jitter stops 500 laptops hitting the API in the same second.
- **TechpioAsset Agent Check-in** (1.3.0+) — every **5 minutes**, a few bytes
  (agent version and machine id). It keeps the laptop **Online** in the portal
  and picks up **Refresh now**. It never enrols and never repairs a credential;
  that stays with the daily run.

**Run elevated.** TPM, BitLocker and patch state are not readable as a standard
user; unelevated those fields are reported as `null` rather than guessed, and
the credential cannot be saved to the protected location.

### 3. Confirm

The portal's **Discovery** page lists the device within a minute. If the serial
matches an existing asset it links automatically; if it is ambiguous it lands in
the review queue for a human.

---

## Deploying to a fleet

**Datto RMM** — use [`datto-rmm-component.ps1`](datto-rmm-component.ps1) as a
PowerShell component. Set two component variables, `PortalUrl` and
`EnrolmentToken` (masked), and push it to every laptop. The same job installs
the agent where it is missing, upgrades older agents to the current version,
and repairs laptops showing **Needs reinstall**. Datto runs it as SYSTEM, which
is what the agent needs.

**Microsoft Intune** — Devices → Scripts → Add → Windows 10 and later:
- Run this script using the logged-on credentials: **No**
- Enforce script signature check: No (or sign it with your code-signing certificate)
- Run script in 64-bit PowerShell: **Yes**

Because the script self-installs a scheduled task, Intune only has to run it once.

**Group Policy** — Computer Configuration → Preferences → Scheduled Tasks, or a
start-up script, using the same command line.

**Manual pilot** — run the command above on two or three laptops first and watch
them appear. That is the fastest way to confirm the data you get back is the data
you want before touching the fleet.

---

## Operations

| Task | Command |
|---|---|
| Run now (already enrolled) | `.\TechpioAgent.ps1 -PortalUrl <url>` |
| Re-enrol after revocation | add `-EnrolmentToken tae_…` |
| Remove both scheduled tasks | `.\TechpioAgent.ps1 -PortalUrl <url> -Uninstall` |
| Fully unenrol a laptop | remove the task, then delete `C:\ProgramData\TechpioAsset\` |

**Logs:** `C:\ProgramData\TechpioAsset\agent.log`

A typical run takes 30–90 seconds; the slowest part is the Windows Update query
for the missing-patch count.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Invalid enrolment token` | Token rotated or mistyped. Generate a fresh one. |
| `Unknown device credential` | The laptop was revoked in the portal. Re-run with `-EnrolmentToken` to re-enrol. |
| `Could not persist the device credential` | Not elevated. The run still reports; run as administrator so the credential is stored. |
| `tpmPresent` / `diskEncrypted` are empty | Not elevated. These need administrator rights; they are reported as unknown rather than guessed. |
| Laptop shows **Reporting daily**, not Online | It runs an agent older than 1.3.0, which only reports once a day. Re-run the install command (or the Datto component) to upgrade it. |
| Laptop shows **Offline** | No check-in for over 12 minutes: switched off, asleep, or no internet. A **Refresh now** pressed meanwhile is kept for a week and runs when it comes back. |
| Device appears but is not linked to an asset | Its serial does not match any asset. Resolve it in the Discovery review queue — the portal never guesses a link. |

---

## Requirements

Windows 10/11 or Server 2016+, with Windows PowerShell 5.1 (built in) or
PowerShell 7. No runtime to install, no agent service, no inbound network access —
the laptop only makes outbound HTTPS calls to your portal.
