## Install

macOS 13 or later, Apple Silicon or Intel. One command:

```sh
curl -fsSL https://raw.githubusercontent.com/RafeSymonds/anki/main/bin/install-anki | bash
```

That downloads the disk image below, checks it against `SHA256SUMS.txt`,
copies the app to `/Applications` and clears the quarantine flag so it opens
on the first try. Add `--app-name "Anki Desktop"` to install it next to an
existing Anki instead of over it.

By hand:

1. Download `Anki-<version>-macos-universal.dmg`, open it, and drag **Anki**
   to Applications.
2. The app is not signed by an Apple-registered developer, so macOS blocks the
   first launch. Clear the download flag once:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Anki.app
   ```

   Or open the app, then go to **System Settings › Privacy & Security**, find
   the message about Anki near the bottom, and click **Open Anyway**.

## What it is

The standard Anki scheduler, collection format and AnkiWeb sync with a new
native macOS shell in place of the old PyQt one. It reads and writes
`~/Library/Application Support/Anki2` — the same collection as official Anki —
so back up first (`File › Export` in either app), and don't run both at once:
whichever starts second cannot open the collection.

Add-ons are not supported.

## Updating

Run the install command again; it replaces the app in place and leaves your
collection alone.

## Uninstalling

```sh
rm -rf /Applications/Anki.app
```

Your collection stays in `~/Library/Application Support/Anki2`; delete that
folder too if you want the data gone.

## Building it yourself

```sh
git clone https://github.com/RafeSymonds/anki && cd anki
bin/anki package     # builds target/release/bundle
```

See [desktop/README.md](https://github.com/RafeSymonds/anki/blob/main/desktop/README.md).
