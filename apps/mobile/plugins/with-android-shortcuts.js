/**
 * Long-press shortcuts on the app icon (Phase 5, v2.81 / app 0.3.36).
 *
 * Android "static shortcuts": declared in res/xml/shortcuts.xml and pointed
 * at from the launcher activity. Each opens the app on a deep link the router
 * already understands, so a shortcut is only ever a way to a screen that
 * exists - and, like any link, it lands behind the biometric unlock (the
 * session gate remembers where it was going and goes there after unlock).
 *
 * A config plugin rather than a library: the build runs `expo prebuild` every
 * time, so these files are regenerated from here on each build, and three
 * fixed shortcuts need nothing a library would add.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, withStringsXml } = require('expo/config-plugins');

const SHORTCUTS = [
  { id: 'scan', short: 'Scan', long: 'Scan an asset', path: 'scan' },
  { id: 'new_request', short: 'New request', long: 'Raise a new request', path: 'requests' },
  { id: 'my_equipment', short: 'My equipment', long: 'What is issued to me', path: 'my-equipment' },
];

function shortcutsXml(pkg, scheme) {
  const items = SHORTCUTS.map(
    (s) => `  <shortcut
    android:shortcutId="${s.id}"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/shortcut_${s.id}_short"
    android:shortcutLongLabel="@string/shortcut_${s.id}_long">
    <intent
      android:action="android.intent.action.VIEW"
      android:targetPackage="${pkg}"
      android:targetClass="${pkg}.MainActivity"
      android:data="${scheme}://${s.path}" />
  </shortcut>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">\n${items}\n</shortcuts>\n`;
}

module.exports = function withAndroidShortcuts(config) {
  const pkg = config.android?.package;
  const scheme = Array.isArray(config.scheme) ? config.scheme[0] : config.scheme;
  if (!pkg || !scheme)
    throw new Error('with-android-shortcuts: android.package and scheme are required');

  config = withStringsXml(config, (cfg) => {
    const strings = cfg.modResults.resources.string ?? [];
    const keep = strings.filter((s) => !String(s.$?.name ?? '').startsWith('shortcut_'));
    for (const s of SHORTCUTS) {
      keep.push({ $: { name: `shortcut_${s.id}_short` }, _: s.short });
      keep.push({ $: { name: `shortcut_${s.id}_long` }, _: s.long });
    }
    cfg.modResults.resources.string = keep;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (!main) throw new Error('with-android-shortcuts: MainActivity not found in the manifest');
    main['meta-data'] = (main['meta-data'] ?? []).filter(
      (m) => m.$['android:name'] !== 'android.app.shortcuts',
    );
    main['meta-data'].push({
      $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/shortcuts' },
    });
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'shortcuts.xml'), shortcutsXml(pkg, scheme));
      return cfg;
    },
  ]);

  return config;
};

module.exports.SHORTCUTS = SHORTCUTS;
module.exports.shortcutsXml = shortcutsXml;
