#!/usr/bin/env sh
# Regenerate all icon assets from app/public/fleet.png.
# Delegates to scripts/make-app-icons.py (Pillow only, works on Linux CI).
exec python3 ../../../scripts/make-app-icons.py "$@"
