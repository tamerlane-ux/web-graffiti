$systemNode = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if ($systemNode) {
    $nodeExecutable = $systemNode.Source
} elseif (Test-Path -LiteralPath $bundledNode) {
    $nodeExecutable = $bundledNode
} else {
    throw "Node.js is required. Install Node 20.19+ or run this project inside Codex Desktop."
}

$viteExecutable = Join-Path $PSScriptRoot "node_modules\vite\bin\vite.js"
if (-not (Test-Path -LiteralPath $viteExecutable)) {
    throw "Dependencies are missing. Run pnpm install before starting the prototype."
}

& $nodeExecutable $viteExecutable --host 127.0.0.1 --port 4173
