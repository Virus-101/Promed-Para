$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $MyInvocation.MyCommand.Path
$Workstation = Split-Path -Parent $Project
$Sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif (Test-Path 'C:\Users\VIRUS\AppData\Local\Android\Sdk') { 'C:\Users\VIRUS\AppData\Local\Android\Sdk' } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$Java = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { Split-Path -Parent (Split-Path -Parent (Get-Command javac.exe).Source) }
$Tools = Join-Path $Sdk 'build-tools\35.0.1'
$AndroidJar = Join-Path $Sdk 'platforms\android-35\android.jar'
$Build = Join-Path $Project 'build'
$SecretFile = Join-Path $Build 'signing-password.txt'
$Keystore = Join-Path $Build 'promedpara-owner-release.jks'
$Classes = Join-Path $Build 'classes'
$Dex = Join-Path $Build 'dex'
New-Item -ItemType Directory -Force -Path $Build,$Classes,$Dex | Out-Null
foreach ($Required in @((Join-Path $Java 'bin\javac.exe'),(Join-Path $Java 'bin\keytool.exe'),(Join-Path $Java 'bin\jar.exe'),(Join-Path $Tools 'aapt2.exe'),(Join-Path $Tools 'd8.bat'),(Join-Path $Tools 'zipalign.exe'),(Join-Path $Tools 'apksigner.bat'),$AndroidJar)) {
  if (!(Test-Path -LiteralPath $Required)) { throw "Required Android build tool is missing: $Required" }
}
if (!(Test-Path -LiteralPath $SecretFile)) {
  $RandomBytes = New-Object byte[] 32
  $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $Rng.GetBytes($RandomBytes); $Rng.Dispose()
  $Password = [Convert]::ToBase64String($RandomBytes).TrimEnd('=').Replace('+','A').Replace('/','B')
  [IO.File]::WriteAllText($SecretFile,$Password,[Text.Encoding]::ASCII)
} else { $Password = [IO.File]::ReadAllText($SecretFile).Trim() }
if (!(Test-Path -LiteralPath $Keystore)) {
  & (Join-Path $Java 'bin\keytool.exe') -genkeypair -keystore $Keystore -storepass $Password -keypass $Password -alias promedpara-owner -dname 'CN=PromedPara Owner,O=PromedPara,C=MA' -keyalg RSA -keysize 2048 -validity 10000 -noprompt
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local APK signing key.' }
}
Remove-Item -LiteralPath $Classes,$Dex -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Classes,$Dex | Out-Null
$Sources = Get-ChildItem (Join-Path $Project 'src') -Filter '*.java' -Recurse | ForEach-Object FullName
& (Join-Path $Java 'bin\javac.exe') --release 8 -classpath $AndroidJar -d $Classes @Sources
if ($LASTEXITCODE -ne 0) { throw 'Java compilation failed.' }
$BaseApk=Join-Path $Build 'base.apk'; $Unsigned=Join-Path $Build 'unsigned.apk'; $Aligned=Join-Path $Build 'aligned.apk'
$CompiledResources=Join-Path $Build 'compiled-resources.zip'
& (Join-Path $Tools 'aapt2.exe') compile --dir (Join-Path $Project 'res') -o $CompiledResources
if ($LASTEXITCODE -ne 0) { throw 'App icon compilation failed.' }
& (Join-Path $Tools 'aapt2.exe') link -I $AndroidJar -R $CompiledResources --manifest (Join-Path $Project 'AndroidManifest.xml') --min-sdk-version 26 --target-sdk-version 35 --version-code 1 --version-name 1.0 -o $BaseApk
if ($LASTEXITCODE -ne 0) { throw 'Android manifest packaging failed.' }
$ClassFiles = Get-ChildItem $Classes -Filter '*.class' -Recurse | ForEach-Object FullName
& (Join-Path $Tools 'd8.bat') --min-api 26 --lib $AndroidJar --output $Dex $ClassFiles
if ($LASTEXITCODE -ne 0) { throw 'DEX conversion failed.' }
Copy-Item -LiteralPath $BaseApk -Destination $Unsigned -Force
& (Join-Path $Java 'bin\jar.exe') uf $Unsigned -C $Dex classes.dex
if ($LASTEXITCODE -ne 0) { throw 'Could not insert DEX code into the APK.' }
& (Join-Path $Tools 'zipalign.exe') -f 4 $Unsigned $Aligned
if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
$Apk=Join-Path $Workstation 'public\PromedPara-Owner.apk'
Remove-Item -LiteralPath $Apk,($Apk+'.idsig') -Force -ErrorAction SilentlyContinue
& (Join-Path $Tools 'apksigner.bat') sign --v4-signing-enabled false --ks $Keystore --ks-key-alias promedpara-owner --ks-pass "pass:$Password" --key-pass "pass:$Password" --out $Apk $Aligned
if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
& (Join-Path $Tools 'apksigner.bat') verify --verbose $Apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
Write-Host "Built owner app: $Apk"
Write-Host "Keep $Keystore and $SecretFile private to sign future app updates. They are not copied to the workstation install package."
