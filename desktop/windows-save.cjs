const { spawn } = require('node:child_process');
const path = require('node:path');

// File.Replace calls ReplaceFileW with ACL merge errors enabled. Keep the
// staging DACL private before putting any project bytes on disk.
const saveScript = String.raw`
$ErrorActionPreference = 'Stop'
$record = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = [string]$record.target
$parent = [IO.Path]::GetDirectoryName($target)
$stage = [IO.Path]::Combine($parent, '.transmission-save-' + $record.temporaryName)
$temporary = [IO.Path]::Combine($stage, 'project.tmp')
$backup = [IO.Path]::Combine($stage, 'previous.json')
$reparsePoint = [IO.FileAttributes]::ReparsePoint
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User

function Assert-RealDirectory([string]$directory) {
    while ($directory) {
        $attributes = [IO.File]::GetAttributes($directory)
        if (($attributes -band $reparsePoint) -or -not ($attributes -band [IO.FileAttributes]::Directory)) {
            throw 'Invalid save directory'
        }
        $directory = [IO.Path]::GetDirectoryName($directory)
    }
}

function Assert-PrivateStage {
    Assert-RealDirectory $stage
    $acl = [IO.Directory]::GetAccessControl($stage)
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    if (-not $acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference -ne $user -or
        $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') {
        throw 'Invalid private staging permissions'
    }
}

$owned = $false
$published = $false
try {
    Assert-RealDirectory $parent
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $user, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
    if ([IO.Directory]::Exists($stage) -or [IO.File]::Exists($stage)) { throw 'Staging name is in use' }
    [IO.Directory]::CreateDirectory($stage, $acl) | Out-Null
    Assert-PrivateStage
    $owned = $true
    $stream = [IO.FileStream]::new($temporary, 'CreateNew', 'Write', 'None')
    try {
        $bytes = [Convert]::FromBase64String($record.contents)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }

    $delays = @(25, 50, 100, 200, 400)
    for ($attempt = 0; ; $attempt++) {
        Assert-PrivateStage
        $attributes = $null
        try { $attributes = [IO.File]::GetAttributes($target) }
        catch [IO.FileNotFoundException] {}
        if ($null -ne $attributes -and ($attributes -band ($reparsePoint -bor [IO.FileAttributes]::Directory))) {
            throw 'Invalid save destination'
        }
        try {
            if ($null -eq $attributes) { [IO.File]::Move($temporary, $target) }
            else { [IO.File]::Replace($temporary, $target, $backup, $false) }
            $published = $true
            break
        } catch {
            # ReplaceFileW can move the original before reporting a failure.
            # Restore it without overwriting another writer, or retain the backup.
            if ([IO.File]::Exists($backup)) {
                Assert-PrivateStage
                if (-not [IO.File]::Exists($target)) { [IO.File]::Move($backup, $target) }
                throw
            }
            $code = $_.Exception.GetBaseException().HResult -band 65535
            if ($attempt -ge $delays.Length -or $code -notin @(5, 32, 33)) { throw }
            Start-Sleep -Milliseconds $delays[$attempt]
        }
    }
} finally {
    if ($owned) {
        try {
            Assert-PrivateStage
            [IO.File]::Delete($temporary)
            if ($published) { [IO.File]::Delete($backup) }
            if (-not [IO.File]::Exists($backup)) { [IO.Directory]::Delete($stage) }
        } catch {
            if (-not $published) { throw }
        }
    }
}
`;

function windowsPowerShell() {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) throw new Error('Windows SystemRoot is unavailable');
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function windowsPowerShellEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH'));
  return { ...env, ...extra, PSModulePath: path.join(path.dirname(windowsPowerShell()), 'Modules') };
}

async function windowsSaveProject(target, contents, temporaryName) {
  if (!/^[a-z0-9-]+$/i.test(temporaryName)) throw new Error('Invalid staging name');
  const command = Buffer.from(saveScript, 'utf16le').toString('base64');
  // Keep Unicode paths and content independent of the console code page.
  const payload = JSON.stringify({
    target,
    temporaryName,
    contents: Buffer.from(contents, 'utf8').toString('base64'),
  }).replace(/[^\x00-\x7f]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
        windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'], env: windowsPowerShellEnv(),
      });
      child.on('error', reject);
      child.stdin.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error('Save helper failed')));
      child.stdin.end(payload);
    });
  } catch {
    throw new Error('프로젝트를 저장할 수 없습니다. 저장할 파일과 폴더의 권한을 확인해 주세요.');
  }
}

module.exports = { windowsPowerShell, windowsPowerShellEnv, windowsSaveProject };
