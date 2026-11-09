# Bundled license text

`LGPL-2.1-or-later.txt` is copied from GLib 2.86.4's upstream
[`LICENSES/LGPL-2.1-or-later.txt`](https://gitlab.gnome.org/GNOME/glib/-/blob/2.86.4/LICENSES/LGPL-2.1-or-later.txt).
GLib's `COPYING` file points to this text. The macOS resource staging script
uses it when the Homebrew GLib bottle lacks a license file.

`gsap-NOTICE.txt` stands in for a license file the `gsap` npm package doesn't ship: it repeats the
license header of GSAP's source files and points to https://gsap.com/standard-license. The renderer
build's license collector (electron.vite.config.ts) uses it for that package.
