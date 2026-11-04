$root = 'E:\FormEngine'
$tools = "$root\.tools"
$env:TEMP = "$tools\tmp"
$env:TMP = "$tools\tmp"
$env:NUGET_PACKAGES = "$tools\nuget"
$env:DOTNET_CLI_HOME = "$tools\dotnet-home"
$env:DOTNET_ROOT = "$tools\dotnet"
$env:DOTNET_INSTALL_DIR = "$tools\dotnet"
$env:NPM_CONFIG_CACHE = "$tools\npm-cache"
$env:NUGET_HTTP_CACHE_PATH = "$tools\nuget-http"
$env:NUGET_PLUGINS_CACHE_PATH = "$tools\nuget-plugins"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:MSBUILDDISABLENODEREUSE = '1'
$env:DOTNET_MULTILEVEL_LOOKUP = '0'
$env:PATH = "$tools\dotnet;$env:PATH"
Write-Host "FormEngine env active (E: only)"
