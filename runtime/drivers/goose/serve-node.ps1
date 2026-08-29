param(
  [int]$Port = 3284,
  [switch]$PlainHttp
)
# Node-side goose serve on Windows. Set the secret via GOOSE_SERVER__SECRET_KEY:
#   $env:GOOSE_SERVER__SECRET_KEY = '<secret>'; .\serve-node.ps1
# TLS is on by default (self-signed; fingerprint is printed as GOOSED_CERT_FINGERPRINT=...).

if (-not $env:GOOSE_SERVER__SECRET_KEY) {
  Write-Error 'Set $env:GOOSE_SERVER__SECRET_KEY first (must match the desktop-side node config).'
  exit 1
}

if ($PlainHttp) {
  goose serve --host 0.0.0.0 --port $Port
} else {
  goose serve --host 0.0.0.0 --port $Port --tls
}
